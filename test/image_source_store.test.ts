import { expect, test } from "vitest";
import type { AbsolutePath, Readable } from "zarrita";

import { OmeZarrImageSource } from "@/data/ome_zarr/image_source";
import { makeChunk } from "./helpers";

const encoder = new TextEncoder();
const json = (value: unknown) => encoder.encode(JSON.stringify(value));

/** An in-memory store that synthesizes each chunk: value = x + 10 * y. */
function syntheticStore(requests: string[]): Readable {
  const group = {
    zarr_format: 3,
    node_type: "group",
    attributes: {
      ome: {
        version: "0.5",
        multiscales: [
          {
            axes: [
              { name: "y", type: "space" },
              { name: "x", type: "space" },
            ],
            datasets: [
              {
                path: "0",
                coordinateTransformations: [{ type: "scale", scale: [1, 1] }],
              },
            ],
          },
        ],
      },
    },
  };
  const array = {
    zarr_format: 3,
    node_type: "array",
    shape: [4, 6],
    data_type: "uint32",
    chunk_grid: { name: "regular", configuration: { chunk_shape: [2, 3] } },
    chunk_key_encoding: { name: "default", configuration: { separator: "/" } },
    codecs: [{ name: "bytes", configuration: { endian: "little" } }],
    fill_value: 0,
  };
  return {
    async get(key: AbsolutePath) {
      requests.push(key);
      if (key === "/zarr.json") return json(group);
      if (key === "/0/zarr.json") return json(array);
      const m = /^\/0\/c\/(\d+)\/(\d+)$/.exec(key);
      if (!m) return undefined;
      const [cy, cx] = [Number(m[1]), Number(m[2])];
      const data = new Uint32Array(6);
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 3; x++)
          data[y * 3 + x] = cx * 3 + x + 10 * (cy * 2 + y);
      return new Uint8Array(data.buffer);
    },
  };
}

test("fromStore opens a custom store and reads chunks on the main thread", async () => {
  const requests: string[] = [];
  const source = await OmeZarrImageSource.fromStore({
    store: syntheticStore(requests),
  });
  const dims = source.getDimensions();
  expect(dims.x.lods[0].size).toBe(6);
  expect(dims.y.lods[0].size).toBe(4);

  const chunk = makeChunk({
    shape: { x: 3, y: 2, z: 1, c: 1 },
    chunkIndex: { x: 1, y: 1, z: 0, c: 0, t: 0 },
  });
  await source.loader.loadChunkData(chunk, new AbortController().signal);
  expect(requests).toContain("/0/c/1/1");
  expect(Array.from(chunk.data as Uint32Array)).toEqual([
    23, 24, 25, 33, 34, 35,
  ]);
});
