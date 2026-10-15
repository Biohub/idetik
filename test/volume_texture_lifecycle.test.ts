import { expect, test, vi } from "vitest";
import { VolumeLayer } from "@/layers/volume_layer";
import { Texture3D } from "@/objects/textures/texture_3d";
import { WebGLTextures } from "@/renderers/webgl_textures";
import { createNoPrefetchPolicy } from "@/core/image_source_policy";
import type { Chunk, ChunkSource, SourceDimensionMap } from "@/data/chunk";
import { createTestViewport, makeChunk } from "./helpers";

function fixture() {
  const axis = {
    name: "x",
    index: 0,
    lods: [
      { size: 2, chunkSize: 1, scale: 1, translation: 0 },
      { size: 1, chunkSize: 1, scale: 2, translation: 0 },
    ],
  };
  const dimensions: SourceDimensionMap = {
    x: axis,
    y: { ...axis, name: "y", index: 1 },
    z: { ...axis, name: "z", index: 2 },
    c: {
      name: "c",
      index: 3,
      lods: axis.lods.map(() => ({
        size: 2,
        chunkSize: 1,
        scale: 1,
        translation: 0,
      })),
    },
    numLods: 2,
  };
  const source: ChunkSource = {
    loader: {
      getSourceDimensionMap: () => dimensions,
      getBytesPerElement: () => 2,
      loadChunkData: async () => {
        throw Error("Unexpected load");
      },
    },
  };
  const layer = new VolumeLayer({
    source,
    sliceCoords: { t: 0 },
    policy: createNoPrefetchPolicy({ lod: { min: 0, max: 0 } }),
    channelProps: [{ contrastLimits: [0, 10] }, { contrastLimits: [0, 10] }],
  });
  const viewport = createTestViewport();
  viewport.addLayer(layer);
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) throw Error("WebGL2 required for texture lifecycle regression");
  const gpu = new WebGLTextures(gl);
  const texture = () => {
    const value = new Texture3D(new Uint16Array([1]), 1, 1, 1);
    gpu.uploadTexture(value);
    value.releaseCpuData();
    return value;
  };
  const chunk = (c: number, lod = 0) =>
    makeChunk({
      state: "loaded",
      lod,
      shape: { x: 1, y: 1, z: 1 },
      chunkIndex: { c },
      texture: texture(),
    });
  let current: Chunk[] = [];
  vi.spyOn(layer.chunkStoreView!, "getChunksToRender").mockImplementation(
    () => current
  );
  return {
    layer,
    viewport,
    gpu,
    texture,
    chunk,
    show(chunks: Chunk[]) {
      current = chunks;
      layer.update(viewport);
    },
    objects() {
      return Array.from(layer.coverageGroups.values()).flat();
    },
  };
}

test("a surviving spatial group drops an evicted channel's texture", () => {
  const f = fixture(),
    c0 = f.chunk(0),
    c1 = f.chunk(1);
  try {
    f.show([c0, c1]);
    f.gpu.dispose(c1.texture!);
    c1.texture = undefined;
    c1.state = "unloaded";
    f.show([c0]);
    expect(() =>
      f
        .objects()[0]
        .textures.forEach((texture, index) => f.gpu.bindTexture(texture, index))
    ).not.toThrow();
    expect(f.objects()[0].textures).toEqual([c0.texture]);
  } finally {
    f.gpu.disposeAll();
    vi.restoreAllMocks();
  }
});

test("LOD replacement with one channel ready does not retain the old LOD's other channel", () => {
  const f = fixture(),
    old0 = f.chunk(0),
    old1 = f.chunk(1),
    next = f.chunk(0, 1);
  try {
    f.show([old0, old1]);
    f.gpu.dispose(old0.texture!);
    f.gpu.dispose(old1.texture!);
    f.show([next]);
    expect(() =>
      f
        .objects()[0]
        .textures.forEach((texture, index) => f.gpu.bindTexture(texture, index))
    ).not.toThrow();
    expect(f.objects()[0].textures).toEqual([next.texture]);
  } finally {
    f.gpu.disposeAll();
    vi.restoreAllMocks();
  }
});

test("replacement texture on the same chunk invalidates cached volume membership", () => {
  const f = fixture(),
    chunk = f.chunk(0);
  try {
    f.show([chunk]);
    f.gpu.dispose(chunk.texture!);
    chunk.texture = f.texture();
    f.show([chunk]);
    expect(() =>
      f
        .objects()[0]
        .textures.forEach((texture, index) => f.gpu.bindTexture(texture, index))
    ).not.toThrow();
    expect(f.objects()[0].textures).toEqual([chunk.texture]);
  } finally {
    f.gpu.disposeAll();
    vi.restoreAllMocks();
  }
});

test("detach and reattach rebuilds objects for otherwise identical chunk identities", () => {
  const f = fixture(),
    chunk = f.chunk(0);
  try {
    f.show([chunk]);
    f.viewport.removeLayer(f.layer);
    f.viewport.addLayer(f.layer);
    vi.spyOn(f.layer.chunkStoreView!, "getChunksToRender").mockReturnValue([
      chunk,
    ]);
    f.layer.update(f.viewport);
    expect(f.objects()).toHaveLength(1);
    expect(f.objects()[0].textures).toEqual([chunk.texture]);
  } finally {
    f.gpu.disposeAll();
    vi.restoreAllMocks();
  }
});

test("equal grid indices at different LODs are distinct spatial groups", () => {
  const f = fixture(),
    fine = f.chunk(0, 0),
    coarse = f.chunk(1, 1);
  try {
    f.show([fine, coarse]);
    expect(f.objects()).toHaveLength(2);
    expect(f.objects().map((object) => object.textures.length)).toEqual([1, 1]);
  } finally {
    f.gpu.disposeAll();
    vi.restoreAllMocks();
  }
});
