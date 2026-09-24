import { Box3 } from "../math/box3";
import type { PackedSplats } from "./luxar/decode";

export type { PackedSplats };

/**
 * A non-displayed dimension that Gaussian splats are sliced along, such as
 * time.
 */
export type GaussianSplatSliceDimension = {
  /** The dimension name, used as the key in {@link GaussianSplatSlice}. */
  name: string;
  /** The extent of the data along this dimension. */
  range: [number, number];
  /** The spacing between samples along discrete dimensions. */
  step: number | null;
  /** Whether splats snap to sample positions along this dimension. */
  discrete: boolean;
};

/** A slice position for each non-displayed dimension, keyed by name. */
export type GaussianSplatSlice = Record<string, number>;

/**
 * A unit of splats that is loaded and cached as a whole.
 */
export type GaussianSplatBlock = {
  /** Uniquely identifies the block's content, including its slice. */
  key: string;
  /** Upper bound on the number of splats in the block. */
  count: number;
};

/**
 * A source of Gaussian splats for a {@link GaussianSplatLayer}.
 */
export interface GaussianSplatSource {
  /** World-space bounds of the splat centers. */
  readonly bounds: Box3;
  /** The non-displayed dimensions splats are sliced along. */
  readonly sliceDimensions: readonly GaussianSplatSliceDimension[];
  /**
   * Returns the blocks visible at a slice in the order they should be loaded.
   * Earlier blocks are expected to carry most of the visible signal.
   */
  getBlocks(slice: GaussianSplatSlice): GaussianSplatBlock[];
  /** Loads and decodes a block returned by {@link getBlocks}. */
  loadBlock(block: GaussianSplatBlock): Promise<PackedSplats>;
}
