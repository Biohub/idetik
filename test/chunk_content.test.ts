import { describe, expect, test } from "vitest";
import { describeChunk } from "@/data/chunk_content";
import { ChunkStore } from "@/data/chunk_store";
import { createNoPrefetchPolicy } from "@/core/image_source_policy";
import { mat4 } from "gl-matrix";
import { computeSourceChunkStats } from "@/data/chunk_stats";
import type { ChunkSource, SourceDimensionMap } from "@/data/chunk";

describe("decoded chunk content", () => {
  test("recognizes absent/fill-zero data", () => {
    expect(describeChunk(new Uint16Array(8), { x: 2, y: 2, z: 2 })).toMatchObject({ min: 0, max: 0, zero: true });
  });
  test("bounds nonzero data in x-fastest order", () => {
    const data = new Int16Array(24);
    data[1 + 3 * (1 + 2 * 2)] = -7;
    expect(describeChunk(data, { x: 3, y: 2, z: 4 })).toMatchObject({
      min: -7, max: 0, zero: false, nonzeroMin: [1, 1, 2], nonzeroMax: [2, 2, 3],
    });
  });
  test("NaN forbids max-based culling", () => {
    expect(describeChunk(new Float32Array([0, NaN]), { x: 2, y: 1, z: 1 }).max).toBeNaN();
  });
  test("transparent zero residency completes volume LOD without a texture", () => {
    const axis = { name: "x", index: 0, lods: [{ size: 2, chunkSize: 2, scale: 1, translation: 0 }] };
    const dimensions: SourceDimensionMap = { x: axis, y: { ...axis, name: "y", index: 1 }, z: { ...axis, name: "z", index: 2 }, numLods: 1 };
    const store = new ChunkStore(dimensions);
    const view = store.addView(createNoPrefetchPolicy({ lod: { min: 0, max: 0 } }));
    view.updateChunksForVolume({ t: 0 }, mat4.create());
    const chunks = [...view.chunkViewStates.keys()];
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) { chunk.state = "loaded"; store.markZeroResident(chunk); }
    expect(view.hasCompleteVisibleLOD()).toBe(true);
    expect(view.getChunksToRender()).toHaveLength(0);
    expect(computeSourceChunkStats({} as ChunkSource, store).resident).toBe(chunks.length);
  });
});
