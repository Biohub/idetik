import { expect, test } from "vitest";
import { ChunkManager } from "@/data/chunk_manager";
import { ChunkStoreView } from "@/data/chunk_store_view";
import { ChunkSource, SourceDimensionMap } from "@/data/chunk";
import { createNoPrefetchPolicy } from "@/core/image_source_policy";
import { OrthographicCamera } from "@/objects/cameras/orthographic_camera";
import { Texture } from "@/objects/textures/texture";
import { createTestViewport, waitFor } from "./helpers";

function createSource(): ChunkSource {
  const lod = (size: number, chunkSize: number) => [
    { size, scale: 1, chunkSize, translation: 0 },
  ];
  const dimensions: SourceDimensionMap = {
    x: { name: "x", index: 0, lods: lod(512, 256) },
    y: { name: "y", index: 1, lods: lod(512, 256) },
    z: { name: "z", index: 2, lods: lod(10, 5) },
    numLods: 1,
  };
  return {
    loader: {
      getSourceDimensionMap: () => dimensions,
      getBytesPerElement: () => 1,
      loadChunkData: async (chunk) => {
        chunk.data = new Uint8Array(
          chunk.shape.x * chunk.shape.y * chunk.shape.z
        );
      },
    },
  };
}

function requestVisibleChunks(view: ChunkStoreView) {
  const viewport = createTestViewport();
  view.updateChunksForImage(
    { z: 0, c: [0], t: 0 },
    {
      worldViewRect: (viewport.camera as OrthographicCamera).getWorldViewRect(),
      bufferWidthPx: viewport.getBufferRect().width,
    }
  );
}

test("uploadLoadedChunks limits uploads per call across all sources", async () => {
  const uploaded: Texture[] = [];
  const manager = new ChunkManager(
    (texture) => uploaded.push(texture),
    undefined,
    undefined,
    undefined,
    undefined,
    1
  );
  for (const source of [createSource(), createSource()]) {
    requestVisibleChunks(manager.addView(source, createNoPrefetchPolicy()));
  }

  manager.update();
  await waitFor(() => manager.queueStats.running === 0);
  manager.uploadLoadedChunks();
  expect(uploaded).toHaveLength(1);
});
