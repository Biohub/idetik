import { expect, test } from "vitest";

import { readPlyVertices } from "@/data/ply";

type Column = { name: string; type: string; values: number[] };

// Writes a binary PLY with `chunks` leading float-only "chunk" elements
// before the vertex element.
function makePly(columns: Column[], chunks = 0) {
  const count = columns[0].values.length;
  const sizes: Record<string, number> = { float: 4, uchar: 1, double: 8 };
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    ...(chunks ? [`element chunk ${chunks}`, "property float min_x"] : []),
    `element vertex ${count}`,
    ...columns.map((c) => `property ${c.type} ${c.name}`),
    "end_header",
    "",
  ].join("\n");
  const headerBytes = new TextEncoder().encode(header);
  const stride = columns.reduce((sum, c) => sum + sizes[c.type], 0);
  const chunkBytes = chunks * 4;
  const buffer = new ArrayBuffer(
    headerBytes.length + chunkBytes + count * stride
  );
  new Uint8Array(buffer).set(headerBytes);
  const view = new DataView(buffer);
  let offset = headerBytes.length + chunkBytes;
  for (let i = 0; i < count; i++) {
    for (const { type, values } of columns) {
      if (type === "float") view.setFloat32(offset, values[i], true);
      if (type === "double") view.setFloat64(offset, values[i], true);
      if (type === "uchar") view.setUint8(offset, values[i]);
      offset += sizes[type];
    }
  }
  return buffer;
}

test("reads requested vertex properties of mixed types", () => {
  const buffer = makePly([
    { name: "x", type: "float", values: [1.5, -2] },
    { name: "skipped", type: "double", values: [9, 9] },
    { name: "red", type: "uchar", values: [0, 255] },
  ]);
  const { count, properties } = readPlyVertices(buffer, ["x", "red"]);
  expect(count).toBe(2);
  expect(Array.from(properties.x)).toEqual([1.5, -2]);
  expect(Array.from(properties.red)).toEqual([0, 255]);
});

test("skips elements before the vertex element", () => {
  const buffer = makePly([{ name: "x", type: "float", values: [7, 8] }], 3);
  const { properties } = readPlyVertices(buffer, ["x"]);
  expect(Array.from(properties.x)).toEqual([7, 8]);
});

test("rejects unsupported files", () => {
  const ascii = new TextEncoder().encode(
    "ply\nformat ascii 1.0\nelement vertex 0\nend_header\n"
  ).buffer;
  expect(() => readPlyVertices(ascii, [])).toThrow("ascii");
  const buffer = makePly([{ name: "x", type: "float", values: [1] }]);
  expect(() => readPlyVertices(buffer, ["y"])).toThrow("y");
  expect(() => readPlyVertices(new ArrayBuffer(8), [])).toThrow("PLY");
});
