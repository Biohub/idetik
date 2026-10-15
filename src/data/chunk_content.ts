import type { ChunkData } from "./chunk";

export type ChunkContent = {
  min: number;
  max: number;
  nonzeroMin: [number, number, number];
  nonzeroMax: [number, number, number];
  zero: boolean;
  arrayType: string;
};

export type DecodedChunk = { data: ChunkData; content: ChunkContent };

// The processed data are tightly packed x-fastest and contain one channel/time.
export function describeChunk(
  data: ChunkData,
  shape: { x: number; y: number; z: number }
): ChunkContent {
  let min = Infinity,
    max = -Infinity;
  const lower: [number, number, number] = [shape.x, shape.y, shape.z];
  const upper: [number, number, number] = [0, 0, 0];
  let index = 0,
    zero = true;
  for (let z = 0; z < shape.z; z++)
    for (let y = 0; y < shape.y; y++)
      for (let x = 0; x < shape.x; x++) {
        const value = data[index++];
        // NaN prevents culling, rather than silently discarding unknown content.
        min = Math.min(min, value);
        max = Math.max(max, value);
        if (value !== 0) {
          zero = false;
          lower[0] = Math.min(lower[0], x);
          lower[1] = Math.min(lower[1], y);
          lower[2] = Math.min(lower[2], z);
          upper[0] = Math.max(upper[0], x + 1);
          upper[1] = Math.max(upper[1], y + 1);
          upper[2] = Math.max(upper[2], z + 1);
        }
      }
  return {
    min,
    max,
    nonzeroMin: lower,
    nonzeroMax: upper,
    zero,
    arrayType: data.constructor.name,
  };
}
