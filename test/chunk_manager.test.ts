import { describe, expect, test } from "vitest";
import { vec2 } from "gl-matrix";
import type { Chunk, SourceDimensionMap } from "@/data/chunk";
import { ChunkManager } from "@/data/chunk_manager";
import { ChunkStoreView } from "@/data/chunk_store_view";
import { createNoPrefetchPolicy } from "@/core/image_source_policy";
import { Box2 } from "@/math/box2";
import type { Texture } from "@/objects/textures/texture";
import { chunkKey, makeFakeChunkSource, settle } from "./helpers";

// 4 × 4 elements in four 2 × 2 chunks, one z plane, one time point.
function createDimensions(): SourceDimensionMap {
  const plane = [{ size: 4, scale: 1, chunkSize: 2, translation: 0 }];
  const single = [{ size: 1, scale: 1, chunkSize: 1, translation: 0 }];
  return {
    x: { name: "x", index: 0, lods: plane },
    y: { name: "y", index: 1, lods: plane },
    z: { name: "z", index: 2, lods: single },
    t: { name: "t", index: 3, lods: single },
    numLods: 1,
  };
}

// Shows the region from the origin to (size, size) at one element per pixel.
function showRegion(view: ChunkStoreView, size: number) {
  view.updateChunksForImage(
    { z: 0, c: [0], t: 0 },
    {
      worldViewRect: new Box2(
        vec2.fromValues(0, 0),
        vec2.fromValues(size, size)
      ),
      bufferWidthPx: size,
    }
  );
}

function setup({ maxGpuUploadsPerUpdate = 4 } = {}) {
  const fake = makeFakeChunkSource(createDimensions());
  const uploads: { texture: Texture; first: number | undefined }[] = [];
  const disposed: Texture[] = [];
  const manager = new ChunkManager(
    (texture) => {
      uploads.push({ texture, first: texture.data?.[0] });
      texture.needsUpdate = false;
    },
    (texture) => disposed.push(texture),
    () => 0,
    Infinity,
    8,
    maxGpuUploadsPerUpdate
  );
  const view = manager.addView(fake.source, createNoPrefetchPolicy());
  showRegion(view, 4);
  const chunks = () => [...view.chunkViewStates.keys()];
  return { ...fake, manager, view, chunks, uploads, disposed };
}

type Setup = ReturnType<typeof setup>;

// Loads and uploads every visible chunk.
async function loadAll(s: Setup) {
  s.manager.update();
  await settle();
  for (const load of s.loads) load.resolve();
  await settle();
  while (s.chunks().some((chunk) => chunk.texture === undefined)) {
    s.manager.update();
  }
  await settle();
}

function isDrawn(s: Setup, chunk: Chunk) {
  return (
    chunk.state === "loaded" &&
    chunk.texture !== undefined &&
    s.view.getChunksToRender().includes(chunk)
  );
}

function loadsOf(s: Setup, chunk: Chunk) {
  return s.loads.filter(
    (load) =>
      load.chunk.lod === chunk.lod &&
      load.chunk.chunkIndex.x === chunk.chunkIndex.x &&
      load.chunk.chunkIndex.y === chunk.chunkIndex.y
  );
}

describe("ChunkManager with a custom source", () => {
  test("stores loaded data through memory accounting", async () => {
    const s = setup();
    const before = s.manager.memoryStats;

    s.manager.update();
    await settle();
    expect(s.loads).toHaveLength(4);
    const load = s.loads[0];
    load.resolve(new Uint16Array(4).fill(9));
    await settle();

    const chunk = s.chunks().find((c) => c.data !== undefined)!;
    expect(chunk.state).toBe("loaded");
    expect(chunk.rowAlignmentBytes).toBe(2);
    expect(s.manager.memoryStats).toEqual({
      cpuChunkBytes: before.cpuChunkBytes + 8,
      cpuChunkCount: before.cpuChunkCount + 1,
    });

    s.manager.update();
    expect(chunk.texture).toBeDefined();
    expect(chunk.data).toBeUndefined();
    expect(s.manager.memoryStats).toEqual(before);
  });

  test("stores nothing from an aborted load", async () => {
    const s = setup();
    const before = s.manager.memoryStats;

    s.manager.update();
    await settle();
    s.view.dispose();
    s.manager.update();
    expect(s.loads.every((load) => load.signal.aborted)).toBe(true);

    for (const load of s.loads) load.resolve();
    await settle();

    for (const chunk of s.chunks()) {
      expect(chunk.state).toBe("unloaded");
      expect(chunk.data).toBeUndefined();
    }
    expect(s.manager.memoryStats).toEqual(before);
  });

  test("reloads a changed visible chunk into its texture while drawing it", async () => {
    const s = setup();
    await loadAll(s);
    const before = s.manager.memoryStats;
    const chunk = s.chunks()[0];
    const texture = chunk.texture;
    const uploadCount = s.uploads.length;
    expect(isDrawn(s, chunk)).toBe(true);

    s.notify([chunkKey(chunk)]);
    expect(isDrawn(s, chunk)).toBe(true);
    s.manager.update();
    await settle();
    expect(isDrawn(s, chunk)).toBe(true);

    const reload = s.loads[s.loads.length - 1];
    expect(loadsOf(s, chunk)).toHaveLength(2);
    expect(reload.chunk).not.toBe(chunk);
    reload.resolve(7);
    await settle();
    expect(isDrawn(s, chunk)).toBe(true);
    expect(s.manager.memoryStats.cpuChunkBytes).toBe(before.cpuChunkBytes + 4);

    s.manager.update();
    expect(isDrawn(s, chunk)).toBe(true);
    expect(chunk.texture).toBe(texture);
    expect(s.uploads.slice(uploadCount)).toEqual([{ texture, first: 7 }]);
    expect(texture!.data).toBeNull();
    expect(s.disposed).toEqual([]);
    expect(s.manager.memoryStats).toEqual(before);
  });

  test("drops a changed resident chunk that is not needed", async () => {
    const s = setup();
    await loadAll(s);
    const far = s.chunks().find((c) => c.chunkIndex.x === 1)!;
    const texture = far.texture;

    // Only chunk (0, 0) stays in view; the others are released but resident.
    showRegion(s.view, 1);
    s.manager.update();
    expect(far.priority).toBeNull();
    expect(far.texture).toBe(texture);

    const loadCount = s.loads.length;
    s.notify([chunkKey(far)]);
    s.manager.update();
    await settle();

    expect(far.state).toBe("unloaded");
    expect(far.texture).toBeUndefined();
    expect(s.disposed).toEqual([texture]);
    expect(s.loads).toHaveLength(loadCount);
  });

  test("discards a first load that the chunk changed during and loads it again", async () => {
    const s = setup();
    s.manager.update();
    await settle();
    const first = s.loads[0];
    const chunk = s
      .chunks()
      .find(
        (c) =>
          c.chunkIndex.x === first.chunk.chunkIndex.x &&
          c.chunkIndex.y === first.chunk.chunkIndex.y
      )!;
    expect(first.chunk).toBe(chunk);
    expect(chunk.state).toBe("loading");

    s.notify([chunkKey(chunk)]);
    s.manager.update();
    expect(first.signal.aborted).toBe(true);
    first.resolve(3);
    await settle();
    expect(chunk.state).toBe("unloaded");
    expect(chunk.data).toBeUndefined();

    s.manager.update();
    await settle();
    const loads = loadsOf(s, chunk);
    expect(loads).toHaveLength(2);
    loads[1].resolve(5);
    await settle();
    s.manager.update();
    expect(s.uploads.find((u) => u.texture === chunk.texture)?.first).toBe(5);
  });

  test("reloads once more when the chunk changes during a reload", async () => {
    const s = setup();
    await loadAll(s);
    const chunk = s.chunks()[0];
    const texture = chunk.texture;

    s.notify([chunkKey(chunk)]);
    s.manager.update();
    await settle();
    const firstReload = s.loads[s.loads.length - 1];

    s.notify([chunkKey(chunk)]);
    s.manager.update();
    await settle();
    expect(firstReload.signal.aborted).toBe(false);
    expect(loadsOf(s, chunk)).toHaveLength(2);

    firstReload.resolve(2);
    await settle();
    s.manager.update();
    await settle();
    expect(chunk.texture).toBe(texture);
    expect(s.uploads[s.uploads.length - 1]).toEqual({ texture, first: 2 });
    expect(loadsOf(s, chunk)).toHaveLength(3);

    s.loads[s.loads.length - 1].resolve(3);
    await settle();
    s.manager.update();
    await settle();
    expect(isDrawn(s, chunk)).toBe(true);
    expect(chunk.texture).toBe(texture);
    expect(s.uploads[s.uploads.length - 1]).toEqual({ texture, first: 3 });
    expect(loadsOf(s, chunk)).toHaveLength(3);
  });

  test("refreshes every resident chunk when the whole source changed", async () => {
    const s = setup();
    await loadAll(s);
    const textures = s.chunks().map((chunk) => chunk.texture);
    const loadCount = s.loads.length;

    s.notify();
    s.manager.update();
    await settle();
    const reloads = s.loads.slice(loadCount);
    expect(reloads).toHaveLength(4);
    for (const chunk of s.chunks()) {
      expect(loadsOf(s, chunk)).toHaveLength(2);
    }

    for (const load of reloads) load.resolve(4);
    await settle();
    const uploadCount = s.uploads.length;
    s.manager.update();

    const uploaded = s.uploads.slice(uploadCount);
    expect(uploaded.map((u) => u.first)).toEqual([4, 4, 4, 4]);
    expect(new Set(uploaded.map((u) => u.texture))).toEqual(new Set(textures));
    expect(s.chunks().map((chunk) => chunk.texture)).toEqual(textures);
  });

  test("reloads share the per-update upload limit with first uploads", async () => {
    const s = setup({ maxGpuUploadsPerUpdate: 1 });
    await loadAll(s);
    const loadCount = s.loads.length;

    s.notify();
    s.manager.update();
    await settle();
    for (const load of s.loads.slice(loadCount)) load.resolve(6);
    await settle();

    const uploadCount = s.uploads.length;
    s.manager.update();
    expect(s.uploads.length - uploadCount).toBe(1);
    s.manager.update();
    expect(s.uploads.length - uploadCount).toBe(2);
  });

  test("cancels a reload and drops the chunk when it is released", async () => {
    const s = setup();
    await loadAll(s);
    const far = s.chunks().find((c) => c.chunkIndex.x === 1)!;
    const texture = far.texture;

    s.notify([chunkKey(far)]);
    s.manager.update();
    await settle();
    const reload = s.loads[s.loads.length - 1];

    showRegion(s.view, 1);
    s.manager.update();
    expect(reload.signal.aborted).toBe(true);
    expect(far.texture).toBeUndefined();
    expect(s.disposed).toEqual([texture]);

    const before = s.manager.memoryStats;
    reload.resolve();
    await settle();
    s.manager.update();
    expect(s.manager.memoryStats).toEqual(before);
    expect(s.uploads.filter((u) => u.texture === texture)).toHaveLength(1);
  });

  test("subscribes once per source and unsubscribes when its store is disposed", () => {
    const s = setup();
    s.manager.addView(s.source, createNoPrefetchPolicy()).dispose();
    expect(s.listeners.size).toBe(1);

    s.manager.update();
    expect(s.listeners.size).toBe(1);

    s.view.dispose();
    s.manager.update();
    expect(s.listeners.size).toBe(0);
  });
});
