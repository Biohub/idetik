import * as zarr from "zarrita";

import { Chunk, SourceDimension, SourceDimensionMap } from "../chunk";
import { setChunkData } from "../chunk_memory";
import { isTextureUnpackRowAlignment } from "../../objects/textures/texture";

import { Image as OmeZarrImage } from "./0.5/image";

import { ZarrArrayParams } from "../zarr/open";
import { SliceSpec } from "./chunk_processing";
import { fetchAndProcessChunk } from "./worker_pool";

type OmeZarrImageLoaderProps = {
  metadata: OmeZarrImage["ome"]["multiscales"][number];
  arrays: zarr.Array<zarr.DataType, zarr.Readable>[];
  arrayParams: ZarrArrayParams[];
};

// Loads chunks from a multiscale image implementing OME-Zarr v0.5:
// https://ngff.openmicroscopy.org/0.5/#image-layout
export class OmeZarrImageLoader {
  private readonly metadata_: OmeZarrImage["ome"]["multiscales"][number];
  private readonly arrays_: ReadonlyArray<
    zarr.Array<zarr.DataType, zarr.Readable>
  >;
  private readonly arrayParams_: ReadonlyArray<ZarrArrayParams>;
  private readonly dimensions_: SourceDimensionMap;
  private readonly bytesPerElement_: number;

  constructor(props: OmeZarrImageLoaderProps) {
    this.metadata_ = props.metadata;
    this.arrays_ = props.arrays;
    this.arrayParams_ = props.arrayParams;
    this.dimensions_ = inferSourceDimensionMap(this.metadata_, this.arrays_);
    this.bytesPerElement_ = bytesPerElementForDtype(this.arrays_[0].dtype);
  }

  public getSourceDimensionMap(): SourceDimensionMap {
    return this.dimensions_;
  }

  public getBytesPerElement(): number {
    return this.bytesPerElement_;
  }

  public async loadChunkData(chunk: Chunk, signal: AbortSignal) {
    const chunkCoords: number[] = [];
    chunkCoords[this.dimensions_.x.index] = chunk.chunkIndex.x;
    chunkCoords[this.dimensions_.y.index] = chunk.chunkIndex.y;
    if (this.dimensions_.z) {
      chunkCoords[this.dimensions_.z.index] = chunk.chunkIndex.z;
    }

    // internal (ChunkStore) chunks have size 1 in C and T
    // so divide by the actual chunkSize to get the chunkCoord here
    if (this.dimensions_.c) {
      const cLod = this.dimensions_.c.lods[chunk.lod];
      chunkCoords[this.dimensions_.c.index] = Math.floor(
        chunk.chunkIndex.c / cLod.chunkSize
      );
    }
    if (this.dimensions_.t) {
      const tLod = this.dimensions_.t.lods[chunk.lod];
      chunkCoords[this.dimensions_.t.index] = Math.floor(
        chunk.chunkIndex.t / tLod.chunkSize
      );
    }

    const array = this.arrays_[chunk.lod];
    const arrayParams = this.arrayParams_[chunk.lod];

    const cLod = this.dimensions_.c?.lods[chunk.lod];
    const tLod = this.dimensions_.t?.lods[chunk.lod];

    const sliceSpec: SliceSpec = {
      targetShape: chunk.shape,
      chunkIndex: { c: chunk.chunkIndex.c, t: chunk.chunkIndex.t },
      dimIndices: {
        x: this.dimensions_.x.index,
        y: this.dimensions_.y.index,
        z: this.dimensions_.z?.index,
        c: this.dimensions_.c?.index,
        t: this.dimensions_.t?.index,
      },
      cChunkSize: cLod?.chunkSize,
      tChunkSize: tLod?.chunkSize,
    };

    // NOTE: if source chunks have multiple channels/timepoints
    // this results in duplicate fetching and decompression
    const data = await fetchAndProcessChunk(
      array,
      arrayParams,
      chunkCoords,
      sliceSpec,
      { signal }
    );

    const rowAlignment = data.BYTES_PER_ELEMENT;
    if (!isTextureUnpackRowAlignment(rowAlignment)) {
      throw new Error(
        "Invalid row alignment value. Possible values are 1, 2, 4, or 8"
      );
    }
    chunk.rowAlignmentBytes = rowAlignment;
    setChunkData(chunk, data);
  }
}

const BYTES_PER_ELEMENT: Partial<Record<zarr.DataType, number>> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float16: 2,
  float32: 4,
};

function bytesPerElementForDtype(dtype: zarr.DataType): number {
  const bytes = BYTES_PER_ELEMENT[dtype];
  if (bytes === undefined) {
    throw new Error(
      `Unsupported zarr dtype "${dtype}". ` +
        `Supported dtypes: ${Object.keys(BYTES_PER_ELEMENT).join(", ")}`
    );
  }
  return bytes;
}

function inferSourceDimensionMap(
  image: OmeZarrImage["ome"]["multiscales"][number],
  arrays: ReadonlyArray<zarr.Array<zarr.DataType, zarr.Readable>>
): SourceDimensionMap {
  const dimensionNames = image.axes.map((axis) => axis.name);
  const numAxes = image.axes.length;

  const xIndex = findDimensionIndex(dimensionNames, "x");
  const yIndex = findDimensionIndex(dimensionNames, "y");

  const makeSourceDimension = (
    name: string,
    index: number
  ): SourceDimension => {
    const lods = [];
    for (let i = 0; i < image.datasets.length; i++) {
      const dataset = image.datasets[i];
      const array = arrays[i];
      const scale = dataset.coordinateTransformations[0].scale;
      const translation =
        dataset.coordinateTransformations.length === 2
          ? dataset.coordinateTransformations[1].translation
          : new Array(numAxes).fill(0);
      lods.push({
        size: array.shape[index],
        chunkSize: array.chunks[index],
        scale: scale[index],
        translation: translation[index],
      });
    }
    // Normalize translations on spatial axes so chunk.offset = trans + chunkIdx
    // * chunkSize * scale uniformly refers to the voxel-cell corner. Two
    // conventions appear in the wild: "voxel-center" pyramids encode the
    // half-voxel shift across LODs (translation_k - translation_{k-1} === 0.5
    // * (scale_k - scale_{k-1})), "voxel-corner" pyramids keep translation
    // constant. Detect by inspecting the pyramid; if it matches the center
    // pattern, shift translations by -0.5 * scale per LOD so downstream code
    // uses corner extents uniformly. Skip non-spatial axes (c, t) where the
    // convention doesn't apply and ChunkStore enforces translation == 0.
    if (image.axes[index].type === "space" && isVoxelCenterConvention(lods)) {
      for (const lod of lods) lod.translation -= 0.5 * lod.scale;
    }
    return {
      name,
      index,
      unit: image.axes[index].unit,
      lods,
    };
  };

  const dims: SourceDimensionMap = {
    x: makeSourceDimension(dimensionNames[xIndex], xIndex),
    y: makeSourceDimension(dimensionNames[yIndex], yIndex),
    numLods: arrays.length,
  };

  const zIndex = findDimensionIndexSafe(dimensionNames, "z");
  if (zIndex !== -1) {
    dims.z = makeSourceDimension(dimensionNames[zIndex], zIndex);
  }

  const cIndex = findDimensionIndexSafe(dimensionNames, "c");
  if (cIndex !== -1) {
    dims.c = makeSourceDimension(dimensionNames[cIndex], cIndex);
  }

  const tIndex = findDimensionIndexSafe(dimensionNames, "t");
  if (tIndex !== -1) {
    dims.t = makeSourceDimension(dimensionNames[tIndex], tIndex);
  }

  return dims;
}

function compareDimensions(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function findDimensionIndex(dimensions: string[], target: string): number {
  const index = findDimensionIndexSafe(dimensions, target);
  if (index === -1) {
    throw new Error(
      `Could not find "${target}" dimension in [${dimensions.join(", ")}]`
    );
  }
  return index;
}

function findDimensionIndexSafe(dimensions: string[], target: string): number {
  return dimensions.findIndex((d) => compareDimensions(d, target));
}

function isVoxelCenterConvention(
  lods: ReadonlyArray<{ scale: number; translation: number }>
): boolean {
  if (lods.length <= 1) return false;
  for (let i = 1; i < lods.length; i++) {
    const expected = 0.5 * (lods[i].scale - lods[i - 1].scale);
    const actual = lods[i].translation - lods[i - 1].translation;
    if (Math.abs(actual - expected) > 1e-6) return false;
  }
  return true;
}
