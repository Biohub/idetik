import { describe, expect, test } from "vitest";
import { ChunkStore } from "@/data/chunk_store";
import { SourceDimensionMap } from "@/data/chunk";
import { Texture } from "@/objects/textures/texture";
import { Box2 } from "@/math/box2";
import { vec2 } from "gl-matrix";
import {
  createNoPrefetchPolicy,
  createPlaybackPolicy,
} from "@/core/image_source_policy";
import { OrthographicCamera } from "@/objects/cameras/orthographic_camera";
import { Viewport } from "@/core/viewport";
import { createTestViewport } from "./helpers";

function imageView(viewport: Viewport) {
  return {
    worldViewRect: (viewport.camera as OrthographicCamera).getWorldViewRect(),
    bufferWidthPx: viewport.getBufferRect().width,
  };
}

describe("ChunkStoreView disposal", () => {
  test("disposed view's chunks ready for cancellation", () => {
    const store = new ChunkStore(createSimpleDimensions());
    const policy = createNoPrefetchPolicy();
    const view = store.addView(policy);
    const viewport = createTestViewport();

    // mark some chunks as visible/needed
    view.updateChunksForImage({ z: 0, c: [0], t: 0 }, imageView(viewport));
    expect(view.chunkViewStates.size).toBeGreaterThan(0);

    // aggregate states and set priority
    let collectedChunks = store.updateAndCollectChunkChanges();
    expect(collectedChunks.size).toBeGreaterThan(0);

    // verify some chunks have priority (are needed)
    for (const chunk of collectedChunks) {
      expect(chunk.priority).not.toBe(null);
    }

    view.dispose();

    // collection should return affected chunks from the disposed view
    // chunks should have priority=null and visible=false (ready for cancellation)
    collectedChunks = store.updateAndCollectChunkChanges();

    expect(collectedChunks.size).toBeGreaterThan(0);

    for (const chunk of collectedChunks) {
      expect(chunk.priority).toBe(null);
      expect(chunk.visible).toBe(false);
    }
  });

  test("disposed view's chunks needed by another view", () => {
    const store = new ChunkStore(createSimpleDimensions());
    const policy = createNoPrefetchPolicy();

    const view1 = store.addView(policy);
    const view2 = store.addView(policy);
    const viewport = createTestViewport();

    // Both views mark same chunks as needed
    view1.updateChunksForImage({ z: 0, c: [0], t: 0 }, imageView(viewport));
    view2.updateChunksForImage({ z: 0, c: [0], t: 0 }, imageView(viewport));

    store.updateAndCollectChunkChanges();

    view1.dispose();

    const collectedChunks = store.updateAndCollectChunkChanges();
    expect(collectedChunks.size).toBeGreaterThan(0);

    // chunks should still have priority because view2 still needs them
    for (const chunk of collectedChunks) {
      expect(chunk.priority).not.toBe(null);
    }
  });
});

// Drawing opportunistic resident chunks the update pass never marked means re-deriving which of
// them cover the slice, here we just test that the math matches
describe("ChunkStoreView multiscale rendering", () => {
  // parameterized over z because z is downsampled in this pyramid
  // coarser chunks span several finer slices
  // the slice coordinate lands mid-chunk for some values
  test.each([0, 1, 2, 3])(
    "zooming in at z=%i keeps the level just left behind ahead of the backdrop",
    (z) => {
      const store = new ChunkStore(createPyramidDimensions());
      const view = store.addView(createNoPrefetchPolicy());
      const lodsOf = () => [
        ...new Set(view.getChunksToRender().map((chunk) => chunk.lod)),
      ];

      view.updateChunksForImage({ z, c: [0] }, viewOfWidth(256));
      expect(view.currentLOD).toBe(1);
      makeResident(store, 1);
      makeResident(store, 2);
      store.updateAndCollectChunkChanges();
      expect(lodsOf()).toEqual([1, 2]);

      view.updateChunksForImage({ z, c: [0] }, viewOfWidth(512));
      expect(view.currentLOD).toBe(0);
      store.updateAndCollectChunkChanges();
      expect(lodsOf()).toEqual([1, 2]);
    }
  );

  // LODs may have different slab thickness, so a sub-slab move changes which
  // of them cover the slice
  test("moving z within one slab still picks the right finer chunk", () => {
    const store = new ChunkStore(createPyramidDimensions());
    const view = store.addView(createNoPrefetchPolicy());
    makeResident(store, 0);
    const finerZ = () =>
      new Set(
        view
          .getChunksToRender()
          .filter((chunk) => chunk.lod === 0)
          .map((chunk) => chunk.chunkIndex.z)
      );

    // LOD 1's z chunks span [0,2) and [2,4), so z=0 and z=1 share a slab
    view.updateChunksForImage({ z: 0, c: [0] }, viewOfWidth(256));
    expect(view.currentLOD).toBe(1);
    expect(finerZ()).toEqual(new Set([0]));

    view.updateChunksForImage({ z: 1, c: [0] }, viewOfWidth(256));
    expect(finerZ()).toEqual(new Set([1]));
  });
});

describe("ChunkStoreView complete visible LOD", () => {
  test("a resident current LOD is complete without the fallback", () => {
    const store = new ChunkStore(createPyramidDimensions());
    const view = store.addView(createNoPrefetchPolicy());
    view.updateChunksForImage({ z: 0, c: [0] }, viewOfWidth(512));
    expect(view.currentLOD).toBe(0);
    expect(view.hasCompleteVisibleLOD()).toBe(false);

    makeResident(store, 0);
    expect(view.hasCompleteVisibleLOD()).toBe(true);
  });

  test("a resident fallback LOD is complete on its own", () => {
    const store = new ChunkStore(createPyramidDimensions());
    const view = store.addView(createNoPrefetchPolicy());
    view.updateChunksForImage({ z: 0, c: [0] }, viewOfWidth(512));

    makeResident(store, 2);
    expect(view.hasCompleteVisibleLOD()).toBe(true);
  });
});

describe("ChunkStoreView slice chunk range", () => {
  // A slice's z range is the extent of the chunk holding it, and is stored in a
  // Box3 as float32. Here z chunk 0 spans [0, 128 * 2.48) = [0, 317.44), but
  // 317.44 is stored as 317.44000244. Divided by the chunk depth that gives
  // 1.0000000077, and rounding up used to request z chunk 1 as well: as
  // spatial prefetch at the current timepoint, and at every prefetched one.
  test("a slice inside z chunk 0 requests no chunks from z chunk 1", () => {
    const store = new ChunkStore(createFloat32EdgeDimensions());
    const view = store.addView(
      createPlaybackPolicy({ prefetch: { x: 0, y: 0, z: 0, t: 2 } })
    );

    view.updateChunksForImage({ z: 100, t: 0, c: [0] }, viewOfWidth(512));

    const requested = [...view.chunkViewStates]
      .filter(([, state]) => state.priority !== null)
      .map(([chunk]) => chunk);
    const zChunks = new Set(requested.map((chunk) => chunk.chunkIndex.z));
    expect(zChunks).toEqual(new Set([0]));

    // the 2x2 chunks in view, at the current timepoint and both prefetched
    for (const t of [0, 1, 2]) {
      const atT = requested.filter((chunk) => chunk.chunkIndex.t === t);
      expect(atT).toHaveLength(4);
    }
  });
});

// A 512-unit view over `bufferWidthPx` pixels: 256 selects LOD 1, 512 LOD 0.
function viewOfWidth(bufferWidthPx: number) {
  return {
    worldViewRect: new Box2(vec2.fromValues(0, 0), vec2.fromValues(512, 512)),
    bufferWidthPx,
  };
}

function makeResident(store: ChunkStore, lod: number) {
  store.forEachChunkInPlane(lod, 0, 0, (chunk) => {
    chunk.state = "loaded";
    store.setChunkTexture(chunk, {} as Texture);
  });
}

function createPyramidDimensions(): SourceDimensionMap {
  const plane = [512, 256, 128].map((size, lod) => ({
    size,
    scale: 2 ** lod,
    chunkSize: 64,
    translation: 0,
  }));
  const z = [4, 2, 1].map((size, lod) => ({
    size,
    scale: 2 ** lod,
    chunkSize: 1,
    translation: 0,
  }));
  return {
    x: { name: "x", index: 0, lods: plane },
    y: { name: "y", index: 1, lods: plane },
    z: { name: "z", index: 2, lods: z },
    numLods: 3,
  };
}

function createSimpleDimensions(): SourceDimensionMap {
  return {
    x: {
      name: "x",
      index: 0,
      lods: [
        {
          size: 512,
          scale: 1,
          chunkSize: 256,
          translation: 0,
        },
      ],
    },
    y: {
      name: "y",
      index: 1,
      lods: [
        {
          size: 512,
          scale: 1,
          chunkSize: 256,
          translation: 0,
        },
      ],
    },
    z: {
      name: "z",
      index: 2,
      lods: [
        {
          size: 10,
          scale: 1,
          chunkSize: 5,
          translation: 0,
        },
      ],
    },
    numLods: 1,
  };
}

// Two 128-voxel z chunks at 2.48 units per voxel, so the edge between them is
// 317.44, which float32 can't represent exactly.
function createFloat32EdgeDimensions(): SourceDimensionMap {
  const plane = [{ size: 512, scale: 1, chunkSize: 256, translation: 0 }];
  return {
    x: { name: "x", index: 0, lods: plane },
    y: { name: "y", index: 1, lods: plane },
    z: {
      name: "z",
      index: 2,
      lods: [{ size: 256, scale: 2.48, chunkSize: 128, translation: 0 }],
    },
    t: {
      name: "t",
      index: 3,
      lods: [{ size: 3, scale: 1, chunkSize: 1, translation: 0 }],
    },
    numLods: 1,
  };
}
