import { describe, expect, test, vi } from "vitest";
import { ChunkManager } from "@/data/chunk_manager";
import { ChunkStore } from "@/data/chunk_store";
import { Chunk, SourceDimensionMap } from "@/data/chunk";
import { setChunkData } from "@/data/chunk_memory";
import { createNoPrefetchPolicy } from "@/core/image_source_policy";
import { viewOf } from "./helpers";

describe("ChunkManager entries", () => {
  test("entries are dropped as the view moves on", async () => {
    const admit = vi.spyOn(ChunkStore.prototype, "admit");
    const { manager, view, pending } = setup();
    for (let step = 0; step < 16; ++step) {
      const at = step * 256;
      view.updateChunksForImage({ t: 0, c: [0] }, viewOf(at, at, 512, 512));
      manager.update();
      await settle();
      for (const load of pending.splice(0, pending.length / 2)) load.resolve();
      await settle();
    }
    for (const load of pending.splice(0)) load.resolve();
    await settle();
    manager.update();

    const store = admit.mock.contexts[0] as ChunkStore;
    expect([...store.entries.keys()].sort()).toEqual(
      [...view.chunkViewStates.keys()].sort()
    );
    admit.mockRestore();
  });
});

type PendingLoad = { chunk: Chunk; resolve: () => void };

function setup() {
  const pending: PendingLoad[] = [];
  const dimensions: SourceDimensionMap = {
    x: {
      name: "x",
      index: 1,
      lods: [{ size: 4096, scale: 1, chunkSize: 256, translation: 0 }],
    },
    y: {
      name: "y",
      index: 0,
      lods: [{ size: 4096, scale: 1, chunkSize: 256, translation: 0 }],
    },
    numLods: 1,
  };
  const loader = {
    getSourceDimensionMap: () => dimensions,
    getBytesPerElement: () => 1,
    loadChunkData: (chunk: Chunk) =>
      new Promise<void>((resolve) => {
        pending.push({
          chunk,
          resolve: () => {
            setChunkData(chunk, new Uint8Array(chunk.shape.x * chunk.shape.y));
            resolve();
          },
        });
      }),
  };
  const manager = new ChunkManager();
  const view = manager.addView({ loader }, createNoPrefetchPolicy());
  return { manager, view, pending };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
