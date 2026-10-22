type PlyType =
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "float32"
  | "float64";

// PLY allows both the legacy and sized type names.
const PLY_TYPES: Record<string, PlyType> = {
  char: "int8",
  int8: "int8",
  uchar: "uint8",
  uint8: "uint8",
  short: "int16",
  int16: "int16",
  ushort: "uint16",
  uint16: "uint16",
  int: "int32",
  int32: "int32",
  uint: "uint32",
  uint32: "uint32",
  float: "float32",
  float32: "float32",
  double: "float64",
  float64: "float64",
};

const TYPE_BYTES: Record<PlyType, number> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
};

type PlyProperty = { name: string; type: PlyType; offset: number };

type PlyElement = {
  name: string;
  count: number;
  stride: number;
  properties: PlyProperty[];
};

type Reader = (view: DataView, offset: number) => number;

const READERS: Record<PlyType, Reader> = {
  int8: (view, offset) => view.getInt8(offset),
  uint8: (view, offset) => view.getUint8(offset),
  int16: (view, offset) => view.getInt16(offset, true),
  uint16: (view, offset) => view.getUint16(offset, true),
  int32: (view, offset) => view.getInt32(offset, true),
  uint32: (view, offset) => view.getUint32(offset, true),
  float32: (view, offset) => view.getFloat32(offset, true),
  float64: (view, offset) => view.getFloat64(offset, true),
};

function parseHeader(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const marker = "end_header\n";
  const limit = Math.min(bytes.length, 64 * 1024);
  // Latin-1 maps each byte to one character, so indices are byte offsets.
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, limit));
  const end = text.indexOf(marker);
  if (!text.startsWith("ply") || end === -1) {
    throw new Error("Not a PLY file");
  }

  const elements: PlyElement[] = [];
  const comments: string[] = [];
  for (const line of text.slice(0, end).split(/\r?\n/)) {
    const [keyword, ...rest] = line.trim().split(/\s+/);
    if (keyword === "comment") {
      comments.push(line.trim().slice("comment".length).trim());
    }
    if (keyword === "format" && rest[0] !== "binary_little_endian") {
      throw new Error(`Unsupported PLY format: ${rest[0]}`);
    }
    if (keyword === "element") {
      elements.push({
        name: rest[0],
        count: Number(rest[1]),
        stride: 0,
        properties: [],
      });
    }
    if (keyword === "property") {
      const element = elements[elements.length - 1];
      if (rest[0] === "list") {
        throw new Error(`Unsupported PLY list property in ${element.name}`);
      }
      const type = PLY_TYPES[rest[0]];
      if (type === undefined) {
        throw new Error(`Unsupported PLY property type: ${rest[0]}`);
      }
      element.properties.push({
        name: rest[1],
        type,
        offset: element.stride,
      });
      element.stride += TYPE_BYTES[type];
    }
  }
  return { elements, comments, dataOffset: end + marker.length };
}

/**
 * Reads the named properties of the `vertex` element of a binary
 * little-endian PLY file.
 *
 * @param buffer - The PLY file contents.
 * @param names - The vertex properties to read.
 * @returns The vertex count, one array per requested property, and the
 *   header comments.
 */
export function readPlyVertices<Name extends string>(
  buffer: ArrayBuffer,
  names: readonly Name[]
): {
  count: number;
  properties: Record<Name, Float32Array>;
  comments: string[];
} {
  const { elements, comments, dataOffset } = parseHeader(buffer);
  let offset = dataOffset;
  let vertex: PlyElement | undefined;
  for (const element of elements) {
    if (element.name === "vertex") {
      vertex = element;
      break;
    }
    offset += element.count * element.stride;
  }
  if (!vertex) {
    throw new Error("PLY file has no vertex element");
  }

  const { count, stride } = vertex;
  const columns = names.map((name) => {
    const property = vertex.properties.find((p) => p.name === name);
    if (!property) {
      throw new Error(`PLY vertex element has no property ${name}`);
    }
    return { ...property, values: new Float32Array(count) };
  });

  // One pass over the vertices is much faster than one per property.
  const view = new DataView(buffer);
  const readers = columns.map((c) => READERS[c.type]);
  for (let i = 0; i < count; i++) {
    const row = offset + i * stride;
    for (let j = 0; j < columns.length; j++) {
      columns[j].values[i] = readers[j](view, row + columns[j].offset);
    }
  }

  const properties = {} as Record<Name, Float32Array>;
  columns.forEach((c, j) => (properties[names[j]] = c.values));
  return { count, properties, comments };
}
