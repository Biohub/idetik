import { describe, expect, test } from "vitest";
import { ChunkStore } from "@/data/chunk_store";
import { Chunk, SourceDimensionMap } from "@/data/chunk";
import { Texture } from "@/objects/textures/texture";
import { Box2 } from "@/math/box2";
import { vec2 } from "gl-matrix";
import { createNoPrefetchPolicy } from "@/core/image_source_policy";

// Chunk descriptors are created when something touches them and dropped
// once nothing needs them, so a store's memory follows the working set, not
// the source: a stitched plate with millions of chunks costs nothing until
// viewed.
describe("ChunkStore descriptors", () => {
  test("constructing a store allocates no chunk descriptors", () => {
    const store = new ChunkStore(createStitchedPlateDimensions());
    expect(store.chunkCount).toBe(0);
    // 198137 × 152529 px at 1024² chunks, 178 timepoints, 2 channels, 6 levels:
    // the dense grid would be about 13.8 million descriptors.
    const g = store.chunkCounts(0);
    expect(g.x * g.y * 178 * 2).toBeGreaterThan(10_000_000);
  });

  test("a view creates only the chunks it looks at", () => {
    const store = new ChunkStore(createStitchedPlateDimensions());
    const view = store.addView(createNoPrefetchPolicy());
    // A 4096-unit window at full resolution covers a 4×4 block of 1024² chunks
    // (plus the fallback LOD's), out of millions.
    view.updateChunksForImage({ t: 0, c: [0] }, viewOf(0, 0, 4096, 4096));
    store.updateAndCollectChunkChanges();
    expect(store.chunkCount).toBeGreaterThan(0);
    expect(store.chunkCount).toBeLessThan(200);
    expect(store.chunkCount).toBe(view.chunkViewStates.size);
  });

  test("chunks the view moved away from are released once unneeded", () => {
    const store = new ChunkStore(createStitchedPlateDimensions());
    const view = store.addView(createNoPrefetchPolicy());
    view.updateChunksForImage({ t: 0, c: [0] }, viewOf(0, 0, 4096, 4096));
    const first = store.updateAndCollectChunkChanges();
    expect(store.chunkCount).toBe(first.size);

    // Far away: nothing in common with the first window.
    view.updateChunksForImage(
      { t: 0, c: [0] },
      viewOf(100_000, 100_000, 4096, 4096)
    );
    const changed = store.updateAndCollectChunkChanges();
    // Chunks of the first window are no longer wanted, and nothing is in
    // flight, so they can go.
    for (const chunk of changed) {
      if (chunk.priority === null) {
        // What the chunk manager does: cancel, then drop the descriptor.
        if (chunk.state === "queued") chunk.state = "unloaded";
        expect(store.releaseChunkIfUnused(chunk)).toBe(true);
      }
    }
    expect(store.chunkCount).toBe(view.chunkViewStates.size);
    for (const chunk of first)
      expect(view.chunkViewStates.has(chunk)).toBe(false);
  });

  test("resident, queued and loading chunks are kept", () => {
    const store = new ChunkStore(createStitchedPlateDimensions());
    const resident = store.getChunk(0, 0, 0, 0, 0, 0);
    resident.state = "loaded";
    store.setChunkTexture(resident, {} as Texture);
    const loading = store.getChunk(0, 0, 0, 0, 0, 1);
    loading.state = "loading";
    const queued = store.getChunk(0, 0, 0, 0, 0, 2);
    queued.state = "queued";
    const idle = store.getChunk(0, 0, 0, 0, 0, 3);
    expect(store.chunkCount).toBe(4);

    expect(store.releaseChunkIfUnused(resident)).toBe(false);
    expect(store.releaseChunkIfUnused(loading)).toBe(false);
    expect(store.releaseChunkIfUnused(queued)).toBe(false);
    expect(store.releaseChunkIfUnused(idle)).toBe(true);
    expect(store.chunkCount).toBe(3);

    // Once the texture goes and it is unloaded, the resident one can go too.
    store.clearChunkTexture(resident);
    resident.state = "unloaded";
    expect(store.releaseChunkIfUnused(resident)).toBe(true);
    expect(store.chunkCount).toBe(2);
  });

  test("a released chunk comes back identical", () => {
    const store = new ChunkStore(createStitchedPlateDimensions());
    const a = store.getChunk(2, 5, 1, 0, 3, 7);
    const snapshot = JSON.stringify(a);
    expect(store.releaseChunkIfUnused(a)).toBe(true);
    const b = store.getChunk(2, 5, 1, 0, 3, 7);
    expect(b).not.toBe(a);
    expect(JSON.stringify(b)).toBe(snapshot);
    expect(b.offset).toEqual({ x: 7 * 1024 * 4, y: 3 * 1024 * 4, z: 0 });
    expect(b.shape).toEqual({ x: 1024, y: 1024, z: 1, c: 1 });
  });

  test("the same object is returned while a chunk is alive", () => {
    const store = new ChunkStore(createStitchedPlateDimensions());
    const a = store.getChunk(0, 1, 1, 0, 2, 2);
    const seen: Chunk[] = [];
    store.forEachChunkInRange(
      0,
      1,
      1,
      { xMin: 2, xMax: 3, yMin: 2, yMax: 3, zMin: 0, zMax: 1 },
      (chunk) => seen.push(chunk)
    );
    expect(seen).toEqual([a]);
    expect(store.chunkCount).toBe(1);
  });
});

/** A world-space window for `updateChunksForImage`, at full-resolution pixel
 *  density (one buffer pixel per unit). */
function viewOf(x: number, y: number, width: number, height: number) {
  return {
    worldViewRect: new Box2(
      vec2.fromValues(x, y),
      vec2.fromValues(x + width, y + height)
    ),
    bufferWidthPx: width,
  };
}

/** The LiveScreen stitched plate's well geometry (A/1/0): 198137 × 152529 px,
 *  1024² chunks, 6 levels, 178 timepoints, 2 channels. */
function createStitchedPlateDimensions(): SourceDimensionMap {
  const levels = 6;
  const lods = (size: number) =>
    Array.from({ length: levels }, (_, lod) => ({
      size: Math.ceil(size / 2 ** lod),
      scale: 2 ** lod,
      chunkSize: 1024,
      translation: 0,
    }));
  const flat = (size: number) =>
    Array.from({ length: levels }, () => ({
      size,
      scale: 1,
      chunkSize: 1,
      translation: 0,
    }));
  return {
    x: { name: "x", index: 4, lods: lods(198137) },
    y: { name: "y", index: 3, lods: lods(152529) },
    c: { name: "c", index: 1, lods: flat(2) },
    t: { name: "t", index: 0, lods: flat(178) },
    numLods: levels,
  };
}
