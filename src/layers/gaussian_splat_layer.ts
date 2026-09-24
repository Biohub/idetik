import { mat4 } from "gl-matrix";

import { Layer } from "../core/layer";
import { Viewport } from "../core/viewport";
import { IdetikContext } from "../idetik";
import { Box3 } from "../math/box3";
import { ColormapName, colormapLut } from "../math/colormaps";
import { Texture2D } from "../objects/textures/texture_2d";
import {
  GaussianSplatRenderable,
  splatDataLength,
  splatOrderLength,
} from "../objects/renderable/gaussian_splat_renderable";
import type {
  GaussianSplatBlock,
  GaussianSplatSlice,
  GaussianSplatSource,
  PackedSplats,
} from "../data/gaussian_splat_source";
import { PACKED_SPLAT_UINTS, SPLAT_CULL_FLOATS } from "../data/luxar/decode";
import { Logger } from "../utilities/logger";
import type {
  SplatSortRequest,
  SplatSortResponse,
} from "../utilities/splat_sort_worker";
// "inline" import to ensure worker code works in dependent projects
// see https://github.com/vitejs/vite/issues/11672
import SplatSortWorker from "../utilities/splat_sort_worker.ts?worker&inline";

/**
 * How overlapping splats combine.
 *
 * - `"additive"` sums emission and needs no sorting.
 * - `"volumetric"` composites emission and absorption back to front, so
 *   dense regions occlude what lies behind them.
 */
export type GaussianSplatCompositing = "additive" | "volumetric";

/**
 * Initialization properties for constructing a Gaussian splat layer.
 */
export type GaussianSplatLayerProps = {
  /** The splats to render. */
  source: GaussianSplatSource;
  /** Positions along the source's non-displayed dimensions. */
  slice?: GaussianSplatSlice;
  /** How overlapping splats combine. Defaults to `"additive"`. */
  compositing?: GaussianSplatCompositing;
  /** Scales splat emission and density. Defaults to `1`. */
  opacity?: number;
  /** Absorption per unit density in volumetric compositing. Defaults to `1`. */
  absorption?: number;
  /** Multiplies the colormapped color. Defaults to `1`. */
  intensity?: number;
  /** Added to the colormapped color. Defaults to `0`. */
  offset?: number;
  /** Gamma applied to amplitude before colormapping. Defaults to `1`. */
  gamma?: number;
  /** Colormap for splat amplitudes. Defaults to `"gray"`. */
  colormap?: ColormapName;
  /** Amplitudes mapped to the ends of the colormap. Defaults to `[0, 1]`. */
  amplitudeRange?: [number, number];
  /** Splat extent in standard deviations. Defaults to `3`. */
  truncationRadius?: number;
  /** Upper bound on the number of splats drawn. Defaults to no limit. */
  maxSplats?: number;
  /** Memory for decoded blocks kept for reuse. Defaults to `1024`. */
  cacheSizeMB?: number;
  /** Blocks loaded concurrently. Defaults to `4`. */
  maxConcurrentLoads?: number;
};

// The 2D low-pass dilation in CSS pixels², as in 3DGS.
const COV2D_DILATION = 0.3;
// Splats whose footprint reaches this fraction of the viewport fade out.
const MAX_EXTENT_FACTOR = 0.33;
// Splats whose estimated brightness summed over the screen is below one 8-bit
// level are not drawn.
const MIN_CONTRIBUTION = 1 / 255;
// Culling runs a frame or more behind the camera, so keep splats slightly
// outside the viewport (in NDC units).
const CULL_MARGIN = 0.1;

/**
 * A layer that renders 3D Gaussian splats.
 *
 * Splats are drawn as screen-space ellipses from their projected
 * covariance, and their brightness integrates the Gaussian along the view
 * ray. They are colored by amplitude through a colormap. Blocks from the
 * source load in order and are drawn as they arrive, so coarse levels show
 * first and refine. When the slice changes the previous splats stay on
 * screen until the first block of the new slice loads.
 *
 * ```ts
 * const source = await LuxarGSplatSource.fromHttp({ url });
 * const layer = new GaussianSplatLayer({
 *   source,
 *   slice: { Time: 0 },
 *   compositing: "volumetric",
 *   colormap: "plasma",
 * });
 * viewport.addLayer(layer);
 * ```
 *
 * @group Layers
 */
export class GaussianSplatLayer extends Layer {
  /** Identifies the layer type as `GaussianSplatLayer`. */
  public readonly type = "GaussianSplatLayer";

  /** Absorption per unit density in volumetric compositing. */
  public absorption: number;
  /** Multiplies the colormapped color. */
  public intensity: number;
  /** Added to the colormapped color. */
  public offset: number;
  /** Gamma applied to amplitude before colormapping. */
  public gamma: number;
  /** Amplitudes mapped to the ends of the colormap. */
  public amplitudeRange: [number, number];
  /** Splat extent in standard deviations. */
  public truncationRadius: number;

  private readonly source_: GaussianSplatSource;
  private readonly renderable_: GaussianSplatRenderable;
  private readonly cache_ = new Map<string, PackedSplats>();
  private readonly loading_ = new Set<string>();
  private readonly maxConcurrentLoads_: number;
  private readonly cacheLimitBytes_: number;
  private compositing_: GaussianSplatCompositing;
  private colormap_: ColormapName;
  private slice_: GaussianSplatSlice;
  private maxSplats_: number;
  private wanted_: GaussianSplatBlock[] = [];
  private displayedKeys_: string[] = [];
  private cacheBytes_ = 0;

  private sortWorker_?: Worker;
  private contentVersion_ = 0;
  private cullInFlight_ = false;
  private lastCullKey_: number[] | null = null;

  /**
   * Creates a layer that renders splats from a source.
   *
   * @param props - Initialization properties.
   */
  constructor({
    source,
    slice = {},
    compositing = "additive",
    opacity = 1,
    absorption = 1,
    intensity = 1,
    offset = 0,
    gamma = 1,
    colormap = "gray",
    amplitudeRange = [0, 1],
    truncationRadius = 3,
    maxSplats = Infinity,
    cacheSizeMB = 1024,
    maxConcurrentLoads = 4,
  }: GaussianSplatLayerProps) {
    super({ opacity, blendMode: blendModeFor(compositing), occludes: false });
    this.source_ = source;
    this.compositing_ = compositing;
    this.absorption = absorption;
    this.intensity = intensity;
    this.offset = offset;
    this.gamma = gamma;
    this.colormap_ = colormap;
    this.amplitudeRange = amplitudeRange;
    this.truncationRadius = truncationRadius;
    this.maxSplats_ = maxSplats;
    this.cacheLimitBytes_ = cacheSizeMB * 1024 * 1024;
    this.maxConcurrentLoads_ = maxConcurrentLoads;
    this.slice_ = { ...slice };

    this.renderable_ = new GaussianSplatRenderable(
      createColormapTexture(colormap)
    );
    this.addObject(this.renderable_);
    this.updateWantedBlocks();
    this.setState("loading");
  }

  /** How overlapping splats combine. */
  public get compositing() {
    return this.compositing_;
  }

  /** @param value - The compositing mode. */
  public set compositing(value: GaussianSplatCompositing) {
    this.compositing_ = value;
    this.blendMode = blendModeFor(value);
  }

  /** The colormap for splat amplitudes. */
  public get colormap() {
    return this.colormap_;
  }

  /** @param value - A built-in colormap name. */
  public set colormap(value: ColormapName) {
    this.colormap_ = value;
    this.renderable_.setColormap(createColormapTexture(value));
  }

  /** Positions along the source's non-displayed dimensions. */
  public get slice(): Readonly<GaussianSplatSlice> {
    return this.slice_;
  }

  /** @param value - The new slice positions. */
  public set slice(value: GaussianSplatSlice) {
    this.slice_ = { ...value };
    this.updateWantedBlocks();
  }

  /** Upper bound on the number of splats drawn. */
  public get maxSplats() {
    return this.maxSplats_;
  }

  /** @param value - The new splat budget. */
  public set maxSplats(value: number) {
    this.maxSplats_ = value;
    this.updateWantedBlocks();
  }

  /** The number of splats loaded for display. */
  public get splatCount() {
    return this.renderable_.count;
  }

  /** The number of splats drawn after culling. */
  public get drawnSplatCount() {
    return this.renderable_.drawCount;
  }

  /** The number of blocks for the current slice that are still loading. */
  public get pendingBlocks() {
    return this.wanted_.filter((block) => !this.cache_.has(block.key)).length;
  }

  public update(viewport?: Viewport) {
    this.startLoads();
    this.updateDisplayedSplats();
    if (viewport) this.requestCull(viewport);
  }

  public override getUniforms(): Record<string, unknown> {
    const t = this.truncationRadius;
    const shiftC = Math.exp(-0.5 * t * t);
    const [minAmplitude, maxAmplitude] = this.amplitudeRange;
    const dpr = window.devicePixelRatio;
    return {
      u_truncate: t,
      u_truncateSq: t * t,
      u_shiftC: shiftC,
      u_invOneMinusC: 1 / (1 - shiftC),
      u_rayIntegralFactor: rayIntegralFactor(t),
      u_cov2DDilation: COV2D_DILATION * Math.max(dpr, 1) ** 2,
      u_maxExtentFactor: MAX_EXTENT_FACTOR,
      u_amplitudeMin: minAmplitude,
      u_amplitudeScale: 1 / Math.max(maxAmplitude - minAmplitude, 1e-30),
      u_invGamma: 1 / this.gamma,
      u_intensity: this.intensity,
      u_offset: this.offset,
      u_absorption: this.absorption,
      // Matches the fragment shader's historical gain-aware discard.
      u_discardDensity: 1e-4 / Math.max(this.intensity, 1),
      u_blendMode: this.compositing_ === "volumetric" ? 1 : 0,
    };
  }

  protected override attach(_context: IdetikContext) {
    this.sortWorker_ = new SplatSortWorker();
    this.sortWorker_.addEventListener(
      "message",
      (e: MessageEvent<SplatSortResponse>) => this.onCulled(e.data)
    );
    this.displayedKeys_ = [];
  }

  protected override detach(_context: IdetikContext) {
    this.sortWorker_?.terminate();
    this.sortWorker_ = undefined;
    this.cullInFlight_ = false;
  }

  private updateWantedBlocks() {
    const blocks = this.source_.getBlocks(this.slice_);
    this.wanted_ = [];
    let total = 0;
    for (const block of blocks) {
      if (this.wanted_.length > 0 && total + block.count > this.maxSplats_) {
        break;
      }
      this.wanted_.push(block);
      total += block.count;
    }
  }

  private startLoads() {
    for (const block of this.wanted_) {
      if (this.loading_.size >= this.maxConcurrentLoads_) return;
      if (this.cache_.has(block.key) || this.loading_.has(block.key)) continue;
      this.loading_.add(block.key);
      this.source_
        .loadBlock(block)
        .then((splats) => this.addToCache(block.key, splats))
        .catch((error) =>
          Logger.error(
            "GaussianSplatLayer",
            `Failed to load block ${block.key}: ${error}`
          )
        )
        .finally(() => this.loading_.delete(block.key));
    }
  }

  private addToCache(key: string, splats: PackedSplats) {
    this.cache_.set(key, splats);
    this.cacheBytes_ += splats.data.byteLength + splats.cullData.byteLength;

    const keep = new Set(this.wanted_.map((block) => block.key));
    for (const key of this.displayedKeys_) keep.add(key);
    for (const [cachedKey, cached] of this.cache_) {
      if (this.cacheBytes_ <= this.cacheLimitBytes_) break;
      if (keep.has(cachedKey)) continue;
      this.cache_.delete(cachedKey);
      this.cacheBytes_ -= cached.data.byteLength + cached.cullData.byteLength;
    }
  }

  private updateDisplayedSplats() {
    const keys = this.wanted_
      .map((block) => block.key)
      .filter((key) => this.cache_.has(key));
    if (keys.length === 0) return;
    if (
      keys.length === this.displayedKeys_.length &&
      keys.every((key, i) => key === this.displayedKeys_[i])
    ) {
      return;
    }

    const blocks = keys.map((key) => this.cache_.get(key)!);
    const count = blocks.reduce((sum, block) => sum + block.count, 0);
    const data = new Uint32Array(splatDataLength(count));
    const cullData = new Float32Array(count * SPLAT_CULL_FLOATS);
    let offset = 0;
    for (const block of blocks) {
      data.set(block.data, offset * PACKED_SPLAT_UINTS);
      cullData.set(block.cullData, offset * SPLAT_CULL_FLOATS);
      offset += block.count;
    }

    this.renderable_.setSplats(data, count, splatBounds(this.source_.bounds));
    this.displayedKeys_ = keys;
    // Refresh the LRU position of displayed blocks.
    for (const block of keys) {
      const splats = this.cache_.get(block)!;
      this.cache_.delete(block);
      this.cache_.set(block, splats);
    }

    this.contentVersion_ += 1;
    this.cullInFlight_ = false;
    this.lastCullKey_ = null;
    this.postSortRequest(
      {
        type: "setSplats",
        version: this.contentVersion_,
        cullData,
        orderLength: splatOrderLength(count),
      },
      [cullData.buffer]
    );
    if (this.state !== "ready") this.setState("ready");
  }

  private requestCull(viewport: Viewport) {
    if (this.cullInFlight_ || this.renderable_.count === 0) return;
    const { camera } = viewport;
    const projection = camera.projectionMatrix;
    const view = camera.viewMatrix;
    const viewProjection = mat4.multiply(mat4.create(), projection, view);
    const { width, height } = viewport.getBufferRect();
    const volumetric = this.compositing_ === "volumetric";
    const contributionScale =
      this.opacity *
      (volumetric ? Math.max(this.intensity, this.absorption) : this.intensity);

    const key = [
      ...viewProjection,
      width,
      height,
      Number(volumetric),
      this.truncationRadius,
      contributionScale,
    ];
    if (this.lastCullKey_ && nearlyEqual(key, this.lastCullKey_)) return;
    this.lastCullKey_ = key;
    this.cullInFlight_ = true;
    this.postSortRequest({
      type: "update",
      version: this.contentVersion_,
      params: {
        viewProjection: Array.from(viewProjection),
        viewZ: [view[2], view[6], view[10], view[14]],
        projectionScale: [projection[0], projection[5]],
        halfResolution: [width / 2, height / 2],
        truncate: this.truncationRadius,
        margin: CULL_MARGIN,
        contributionScale,
        minContribution: MIN_CONTRIBUTION,
        sort: volumetric,
      },
    });
  }

  private postSortRequest(
    request: SplatSortRequest,
    transfer: Transferable[] = []
  ) {
    this.sortWorker_?.postMessage(request, transfer);
  }

  private onCulled({ version, order, count }: SplatSortResponse) {
    if (version !== this.contentVersion_) return;
    this.cullInFlight_ = false;
    this.renderable_.setOrder(order, count);
  }
}

function blendModeFor(compositing: GaussianSplatCompositing) {
  return compositing === "volumetric" ? "premultipliedOver" : "additive";
}

function nearlyEqual(a: number[], b: number[]) {
  return a.every(
    (value, i) =>
      Math.abs(value - b[i]) <= 1e-5 * (Math.abs(value) + Math.abs(b[i]))
  );
}

// Pads center bounds so culling keeps splats that extend past them.
function splatBounds(bounds: Box3) {
  const box = bounds.clone();
  const size = Math.max(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2]
  );
  const pad = 0.05 * size;
  for (let i = 0; i < 3; i++) {
    box.min[i] -= pad;
    box.max[i] += pad;
  }
  return box;
}

function createColormapTexture(name: ColormapName) {
  const texture = new Texture2D(colormapLut(name), 256, 1);
  texture.dataFormat = "rgba";
  texture.minFilter = "linear";
  texture.maxFilter = "linear";
  return texture;
}

// Abramowitz & Stegun 7.1.26, max error 1.5e-7.
function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const y = 1 - poly * Math.exp(-x * x);
  return x < 0 ? -y : y;
}

// The integral along a line through the center of a unit Gaussian shifted
// down to reach zero at the truncation radius t.
function rayIntegralFactor(t: number) {
  return (
    Math.sqrt(2 * Math.PI) * erf(t / Math.SQRT2) -
    2 * t * Math.exp(-0.5 * t * t)
  );
}
