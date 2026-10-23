import {
  type Texture,
  TextureUnpackRowAlignment,
} from "../objects/textures/texture";
import { Logger } from "../utilities/logger";
import { mat4, vec3 } from "gl-matrix";
import { AxisComponent, SliceAxes } from "../math/axes";

const chunkDataTypes = [
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Float32Array,
  // Float16Array is undefined in older browsers; `instanceof undefined` throws.
  ...(typeof Float16Array === "undefined" ? [] : [Float16Array]),
] as const;
export type ChunkDataConstructor = (typeof chunkDataTypes)[number];
export type ChunkData = InstanceType<ChunkDataConstructor>;

export function isChunkData(value: unknown): value is ChunkData {
  if (chunkDataTypes.some((ChunkData) => value instanceof ChunkData)) {
    return true;
  }
  const supportedDataTypeNames = chunkDataTypes.map((dtype) => dtype.name);
  Logger.debug(
    "Chunk",
    `Unsupported chunk data type: ${value}. Supported data types: ${supportedDataTypeNames}`
  );
  return false;
}

export type ChunkViewState = {
  visible: boolean;
  prefetch: boolean;
  priority: number | null;
  orderKey: number | null;
};

export type Chunk = {
  data?: ChunkData;
  texture?: Texture;
  releasedAt?: DOMHighResTimeStamp;
  state: "unloaded" | "queued" | "loading" | "loaded";
  lod: number;
  shape: {
    x: number;
    y: number;
    z: number;
    c: number;
  };
  rowAlignmentBytes: TextureUnpackRowAlignment;
  chunkIndex: {
    x: number;
    y: number;
    z: number;
    c: number;
    t: number;
  };
  scale: {
    x: number;
    y: number;
    z: number;
  };
  offset: {
    x: number;
    y: number;
    z: number;
  };
} & ChunkViewState;

// Maps Idetik spatial dimensions (x, y, z) and non-spatial dimensions (c, t)
// dimensions to a chunk source's dimensions.
/**
 * Per-axis dimension metadata for a multiscale image source.
 *
 * Maps the spatial axes `x`, `y`, `z` and the non-spatial axes `c` and
 * `t` onto the source's stored dimensions.
 */
export type SourceDimensionMap = {
  /** The `x` spatial dimension. */
  x: SourceDimension;
  /** The `y` spatial dimension. */
  y: SourceDimension;
  /** The `z` spatial dimension if present. */
  z?: SourceDimension;
  /** The channel dimension if present. */
  c?: SourceDimension;
  /** The time dimension if present. */
  t?: SourceDimension;
  /** Number of levels of detail in the pyramid. */
  numLods: number;
};

/**
 * One dimension of a multiscale image source.
 */
export type SourceDimension = {
  /** Axis name from the source metadata. */
  name: string;
  /** Position of the axis in the stored arrays. */
  index: number;
  /** Physical unit if declared in the metadata. */
  unit?: string;
  /** Per-LOD metadata ordered finest first. */
  lods: SourceDimensionLod[];
};

/**
 * Metadata for one dimension at one level of detail.
 *
 * Combines array metadata with the OME-Zarr coordinate transform.
 */
export type SourceDimensionLod = {
  /** Extent of the dimension in array elements. */
  size: number;
  /** Chunk extent along the dimension in elements. */
  chunkSize: number;
  /** World units per array element. */
  scale: number;
  /** World coordinate of the first element. */
  translation: number;
};

/**
 * World-space coordinates selecting the data to display.
 */
export type SliceCoordinates = {
  /** Position on the `x` axis in world units. */
  x?: number;
  /** Position on the `y` axis in world units. */
  y?: number;
  /** Position on the `z` axis in world units. */
  z?: number;
  /** Channel indices to load. Defaults to all channels. */
  c?: number[];
  /** The time point to display. */
  t?: number;
};

export type ChunkSource = {
  get loader(): ChunkLoader;
};

export type ChunkLoader = {
  getSourceDimensionMap(): SourceDimensionMap;

  getBytesPerElement(): number;

  loadChunkData(chunk: Chunk, signal: AbortSignal): Promise<void>;
};

export function coordToIndex(lod: SourceDimensionLod, coord: number): number {
  return Math.round((coord - lod.translation) / lod.scale);
}

export function coordToChunkIndex(
  lod: SourceDimensionLod,
  coord: number
): number {
  const index = coordToIndex(lod, coord);
  return Math.floor(index / lod.chunkSize);
}

export function worldToTexCoordForChunk(chunk: Chunk, axes: SliceAxes): mat4 {
  const scale = vec3.create();
  const translation = vec3.create();
  for (const axis of ["x", "y", "z"] as const) {
    const centerShift = axis === axes.w ? 0.5 * chunk.scale[axis] : 0;
    const component = AxisComponent[axis];
    scale[component] = 1 / (chunk.scale[axis] * chunk.shape[axis]);
    translation[component] = centerShift - chunk.offset[axis];
  }
  const m = mat4.fromScaling(mat4.create(), scale);
  return mat4.translate(m, m, translation);
}
