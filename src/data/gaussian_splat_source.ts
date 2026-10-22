import { GaussianSplats, loadGaussianSplatsPly } from "./gaussian_splats";

/**
 * One dimension of the splat centers.
 */
export type GaussianSplatDimension = {
  /** The dimension name. */
  name: string;
  /** The extent of the splat centers along this dimension. */
  range: [number, number];
};

/**
 * A set of 3D Gaussian splats to render with a {@link GaussianSplatLayer}.
 *
 * Layers created from the same source share its loaded data.
 *
 * ```ts
 * const source = await GaussianSplatSource.fromPly(url);
 * const layer = new GaussianSplatLayer({ source });
 * ```
 *
 * @group Data Loading
 */
export class GaussianSplatSource {
  /**
   * Whether the splats were trained with anti-aliasing (Mip-Splatting
   * style). Layers compensate opacity for their screen-space dilation by
   * default when this is `true`. Detected from the header comment Postshot
   * writes, since the PLY layout has no standard field for it.
   */
  public readonly antialiased: boolean;

  private readonly splats_: GaussianSplats;
  private readonly dimensions_: GaussianSplatDimension[];

  private constructor(
    splats: GaussianSplats,
    dimensions: GaussianSplatDimension[],
    antialiased: boolean
  ) {
    this.splats_ = splats;
    this.dimensions_ = dimensions;
    this.antialiased = antialiased;
  }

  /**
   * Loads splats from a PLY file in the layout written by the reference 3D
   * Gaussian Splatting implementation and compatible tools.
   *
   * Color comes from the degree-0 spherical harmonic only, so it does not
   * vary with view direction.
   *
   * @param url - The URL of the PLY file.
   */
  public static async fromPly(url: string) {
    const { splats, antialiased } = await loadGaussianSplatsPly(url);
    const { min, max } = splats.bounds;
    const dimensions = ["x", "y", "z"].map(
      (name, i): GaussianSplatDimension => ({
        name,
        range: [min[i], max[i]],
      })
    );
    return new GaussianSplatSource(splats, dimensions, antialiased);
  }

  /** The number of splats. */
  public get splatCount() {
    return this.splats_.count;
  }

  /**
   * Returns the dimensions of the splat centers in storage order. PLY
   * sources have `x`, `y`, and `z`.
   */
  public getDimensions(): GaussianSplatDimension[] {
    return this.dimensions_.map((dim) => ({ ...dim, range: [...dim.range] }));
  }

  /** @hidden */
  public get splats(): GaussianSplats {
    return this.splats_;
  }
}
