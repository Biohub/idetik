import { Chunk, ChunkData } from "./chunk";

// Running totals for CPU-resident chunk voxel data. All mutations of
// `chunk.data` must route through setChunkData/clearChunkData so these stay
// accurate. Loaders return data and the ChunkManager stores it, so the totals
// hold for any source. Module-level (not per-manager): the totals are summed
// across all Idetik instances in the page, which is fine for the
// single-instance debug/instrumentation use case.

let cpuChunkBytes = 0;
let cpuChunkCount = 0;

export function setChunkData(chunk: Chunk, data: ChunkData): void {
  if (chunk.data) {
    cpuChunkBytes -= chunk.data.byteLength;
    cpuChunkCount -= 1;
  }
  chunk.data = data;
  cpuChunkBytes += data.byteLength;
  cpuChunkCount += 1;
}

export function clearChunkData(chunk: Chunk): void {
  if (chunk.data) {
    cpuChunkBytes -= chunk.data.byteLength;
    cpuChunkCount -= 1;
  }
  chunk.data = undefined;
  chunk.texture?.releaseCpuData();
}

export function chunkMemoryStats() {
  return { cpuChunkBytes, cpuChunkCount };
}
