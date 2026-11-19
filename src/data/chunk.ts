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

/**
 * The voxel data of one chunk, as a typed array of one of the supported
 * element types: `Int8Array`, `Int16Array`, `Int32Array`, `Uint8Array`,
 * `Uint16Array`, `Uint32Array`, `Float32Array` or, where the browser has it,
 * `Float16Array`.
 *
 * @group Data Loading
 */
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
  /** Whether the chunk is in view. */
  visible: boolean;
  /** Whether the chunk is loaded ahead of being in view. */
  prefetch: boolean;
  /** Load rank, lower first, or `null` when the chunk is not needed. */
  priority: number | null;
  /** Tie-break among chunks of equal priority; lower loads first. */
  orderKey: number | null;
};

/**
 * One chunk of a {@link ChunkSource}: a block of one channel at one time
 * point and one level of detail.
 *
 * Idetik creates and owns chunks. A {@link ChunkLoader} reads `lod`,
 * `chunkIndex` and `shape` to know what to load; the other fields describe
 * where the chunk sits in world space and how Idetik is streaming it.
 *
 * @group Data Loading
 */
export type Chunk = {
  /** Loaded data not yet uploaded to the GPU. */
  data?: ChunkData;
  /** GPU texture holding the chunk's data once uploaded. */
  texture?: Texture;
  /** When the chunk was last released by every view. */
  releasedAt?: DOMHighResTimeStamp;
  /** Loading state of the chunk. */
  state: "unloaded" | "queued" | "loading" | "loaded";
  /** Level of detail, 0 being the finest. */
  lod: number;
  /**
   * Extent of the chunk in elements. Chunks on the far edge of the image may
   * be smaller than the source's chunk size; `c` is always 1.
   */
  shape: {
    x: number;
    y: number;
    z: number;
    c: number;
  };
  /** Row alignment of `data` in bytes. */
  rowAlignmentBytes: TextureUnpackRowAlignment;
  /**
   * Position of the chunk in the chunk grid of its level of detail. `c` and
   * `t` are channel and time indices; `x`, `y` and `z` count chunks.
   */
  chunkIndex: {
    x: number;
    y: number;
    z: number;
    c: number;
    t: number;
  };
  /** World units per element along each axis. */
  scale: {
    x: number;
    y: number;
    z: number;
  };
  /** World coordinate of the chunk's first element. */
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

/**
 * Identifies one chunk of a source: its level of detail and its indices in
 * the chunk grid of that level, as in {@link Chunk.chunkIndex}.
 *
 * `c` and `t` are channel and time indices (Idetik chunks hold one channel
 * and one time point); `x`, `y` and `z` count chunks along each axis.
 *
 * @group Data Loading
 */
export type ChunkKey = {
  lod: number;
  t: number;
  c: number;
  /** Defaults to 0 for sources without a `z` dimension. */
  z?: number;
  y: number;
  x: number;
};

/**
 * Receives the chunks whose data changed, or `undefined` when every chunk of
 * the source may have changed.
 *
 * @group Data Loading
 */
export type ChunkChangeListener = (keys?: readonly ChunkKey[]) => void;

/**
 * A chunked multiscale image that layers stream from.
 *
 * {@link OmeZarrImageSource} is one implementation. Any object with a
 * {@link ChunkLoader} works, so applications can serve chunks from their own
 * storage or service.
 *
 * @group Data Loading
 */
export type ChunkSource = {
  /** Describes the source and loads its chunks. */
  get loader(): ChunkLoader;

  /**
   * Optional, for sources whose data changes while it is displayed. Idetik
   * registers a listener when it starts streaming from the source and calls
   * the returned function when it stops.
   *
   * The listener may be called at any time; Idetik applies the changes on
   * its next frame. Chunks that are still needed are loaded again and their
   * textures replaced in place, so the old data stays on screen until the
   * new data arrives. Loads in flight are restarted, and chunks that are no
   * longer needed are dropped.
   */
  onChunksChanged?(listener: ChunkChangeListener): () => void;
};

/**
 * Describes a source's dimensions and loads its chunks.
 *
 * @group Data Loading
 */
export type ChunkLoader = {
  /** Axes, sizes, chunk sizes and scales of every level of detail. */
  getSourceDimensionMap(): SourceDimensionMap;

  /** Bytes per element of the data `loadChunkData` returns. */
  getBytesPerElement(): number;

  /**
   * Loads the data of `chunk`: `chunk.shape.x * chunk.shape.y *
   * chunk.shape.z` elements in x-fastest order. Treat `chunk` as read-only.
   * Reject with an `AbortError` when `signal` aborts.
   */
  loadChunkData(
    chunk: Readonly<Chunk>,
    signal: AbortSignal
  ): Promise<ChunkData>;
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
