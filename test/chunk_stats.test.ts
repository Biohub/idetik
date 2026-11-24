import { describe, expect, test } from "vitest";
import { ChunkKey, ChunkStore } from "@/data/chunk_store";
import { ChunkStoreView } from "@/data/chunk_store_view";
import { ChunkSource, SourceDimensionMap } from "@/data/chunk";
import {
  computeSourceChunkStats,
  computeViewportChunkStats,
} from "@/data/chunk_stats";
import {
  createNoPrefetchPolicy,
  createPlaybackPolicy,
} from "@/core/image_source_policy";
import { Box2 } from "@/math/box2";
import { vec2 } from "gl-matrix";
import type { Texture } from "@/objects/textures/texture";
import { OrthographicCamera } from "@/objects/cameras/orthographic_camera";
import { createTestViewport } from "./helpers";

const source = {} as ChunkSource;

function updateView(view: ChunkStoreView) {
  const viewport = createTestViewport();
  view.updateChunksForImage(
    { z: 0, c: [0], t: 0 },
    {
      worldViewRect: (viewport.camera as OrthographicCamera).getWorldViewRect(),
      bufferWidthPx: viewport.getBufferRect().width,
    }
  );
}

function visibleChunks(view: ChunkStoreView) {
  return [...view.chunkViewStates]
    .filter(([, state]) => state.visible)
    .map(([key]) => key);
}

function makeResident(store: ChunkStore, key: ChunkKey) {
  const chunk = store.admit(key);
  chunk.state = "loaded";
  chunk.texture = {} as Texture;
}

describe("chunk stats", () => {
  test("viewport counts chunks its views request", () => {
    const store = new ChunkStore(createDimensions());
    const view = store.addView(createNoPrefetchPolicy());
    updateView(view);

    const visible = visibleChunks(view);
    expect(visible.length).toBeGreaterThan(0);
    makeResident(store, visible[0]);

    const stats = computeViewportChunkStats("viewport", [{ view, store }]);

    expect(stats.requested).toBe(visible.length);
    expect(stats.resident).toBe(1);
  });

  test("viewport current counts exclude fallback and prefetch", () => {
    const store = new ChunkStore(createTwoLodDimensions());
    const view = store.addView(
      createPlaybackPolicy({ prefetch: { x: 0, y: 0, z: 0, t: 2 } })
    );
    // one world unit per pixel selects LOD 0, so LOD 1 is the fallback
    view.updateChunksForImage(
      { z: 0, c: [0], t: 0 },
      {
        worldViewRect: new Box2(
          vec2.fromValues(0, 0),
          vec2.fromValues(512, 512)
        ),
        bufferWidthPx: 512,
      }
    );
    expect(view.currentLOD).toBe(0);

    const states = [...view.chunkViewStates];
    const drawn = states.filter(
      ([key, state]) => state.visible && store.lodOfKey(key) === 0
    );
    const fallback = states.filter(
      ([key, state]) => state.visible && store.lodOfKey(key) === 1
    );
    const prefetched = states.filter(
      ([key]) => store.indicesOfKey(key).t !== 0
    );
    expect(drawn).toHaveLength(4);
    expect(fallback).toHaveLength(1);
    expect(prefetched).toHaveLength(8);

    makeResident(store, drawn[0][0]);
    makeResident(store, fallback[0][0]);
    makeResident(store, prefetched[0][0]);

    const stats = computeViewportChunkStats("viewport", [{ view, store }]);

    expect(stats.requested).toBe(13);
    expect(stats.resident).toBe(3);
    expect(stats.current).toEqual({ requested: 4, resident: 1 });
  });

  test("source counts chunks shared by views once, per timepoint", () => {
    const store = new ChunkStore(createDimensions());
    const view1 = store.addView(createNoPrefetchPolicy());
    const view2 = store.addView(createNoPrefetchPolicy());
    updateView(view1);
    updateView(view2);

    const visible = visibleChunks(view1);
    makeResident(store, visible[0]);

    store.updateDemand();
    const stats = computeSourceChunkStats(source, store);

    expect(stats.requested).toBe(visible.length);
    expect(stats.resident).toBe(1);
    expect([...stats.timepoints.requested]).toEqual([visible.length, 0, 0]);
    expect([...stats.timepoints.resident]).toEqual([1, 0, 0]);
  });
});

function createDimensions(): SourceDimensionMap {
  return {
    x: {
      name: "x",
      index: 0,
      lods: [{ size: 512, scale: 1, chunkSize: 256, translation: 0 }],
    },
    y: {
      name: "y",
      index: 1,
      lods: [{ size: 512, scale: 1, chunkSize: 256, translation: 0 }],
    },
    z: {
      name: "z",
      index: 2,
      lods: [{ size: 10, scale: 1, chunkSize: 5, translation: 0 }],
    },
    t: {
      name: "t",
      index: 3,
      lods: [{ size: 3, scale: 1, chunkSize: 1, translation: 0 }],
    },
    numLods: 1,
  };
}

// 512 × 512 in 256 chunks at LOD 0, and one 256 chunk at LOD 1.
function createTwoLodDimensions(): SourceDimensionMap {
  const plane = [
    { size: 512, scale: 1, chunkSize: 256, translation: 0 },
    { size: 256, scale: 2, chunkSize: 256, translation: 0 },
  ];
  const single = [
    { size: 1, scale: 1, chunkSize: 1, translation: 0 },
    { size: 1, scale: 1, chunkSize: 1, translation: 0 },
  ];
  return {
    x: { name: "x", index: 0, lods: plane },
    y: { name: "y", index: 1, lods: plane },
    z: { name: "z", index: 2, lods: single },
    t: {
      name: "t",
      index: 3,
      lods: [
        { size: 3, scale: 1, chunkSize: 1, translation: 0 },
        { size: 3, scale: 1, chunkSize: 1, translation: 0 },
      ],
    },
    numLods: 2,
  };
}
