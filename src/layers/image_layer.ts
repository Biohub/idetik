import { BlendMode, Layer } from "../core/layer";
import { Viewport } from "../core/viewport";
import { OrthographicCamera } from "../objects/cameras/orthographic_camera";
import type { IdetikContext } from "../idetik";
import {
  Chunk,
  ChunkSource,
  SliceCoordinates,
  worldToTexCoordForChunk,
} from "../data/chunk";
import {
  AxisComponent,
  SliceAxes,
  SliceOrientation,
  orientationRotation,
  sliceAxesFor,
} from "../math/axes";
import { ChunkStoreView, INTERNAL_POLICY_KEY } from "../data/chunk_store_view";
import {
  createExplorationPolicy,
  ImageSourcePolicy,
} from "../core/image_source_policy";
import {
  ChannelProps,
  ChannelsEnabled,
  validateChannelPropsCount,
} from "../core/channel";
import { ImageRenderable } from "../objects/renderable/image_renderable";
import { Color } from "../math/color";
import { EventContext } from "../core/event_dispatcher";
import { Plane } from "../math/plane";
import { Ray } from "../math/ray";
import { quat, vec2, vec3 } from "gl-matrix";
import { handlePointPickingEvent, PointPickingResult } from "./point_picking";
import { clamp } from "../utilities/clamp";
import { RenderablePool } from "../utilities/renderable_pool";
import { Texture } from "../objects/textures/texture";

/**
 * Initialization properties for constructing an image layer.
 */
export type ImageLayerProps = {
  /** The chunked image source to stream from. */
  source: ChunkSource;
  /** The slice to display in world units. */
  sliceCoords: SliceCoordinates;
  /** Streaming policy. Defaults to the exploration policy. */
  policy?: ImageSourcePolicy;
  /** Slice plane orientation. Defaults to `"XY"`. */
  orientation?: SliceOrientation;
  /** Per-channel appearance. Length must match the source. */
  channelProps?: ChannelProps[];
  /** Called with the picked value when the layer is clicked. */
  onPickValue?: (info: PointPickingResult) => void;
  /** Layer opacity in `[0, 1]`. Defaults to `1`. */
  opacity?: number;
  /** How the layer blends. Defaults to `"additive"`. */
  blendMode?: BlendMode;
  /** Hides content behind. Defaults to `true`. */
  occludes?: boolean;
};

/**
 * A layer that renders a 2D slice of a chunked multi-channel image source.
 *
 * Image layer streams chunks from a source such as
 * {@link OmeZarrImageSource} according to its streaming policy, which
 * decides which resolution levels and chunks to load for the current view.
 * Per-channel appearance is controlled with {@link ChannelProps} and the
 * visible slice is selected with {@link SliceCoordinates}. The layer holds
 * `sliceCoords` by reference, so mutating the object it was constructed
 * with moves through the data.
 *
 * ```ts
 * const source = await OmeZarrImageSource.fromHttp({ url });
 *
 * const layer = new ImageLayer({
 *   source,
 *   sliceCoords: { t: 0, z: 0, c: [0, 1] },
 *   channelProps: [
 *     { color: Color.GREEN, contrastLimits: [0, 1024] },
 *     { color: Color.MAGENTA, contrastLimits: [0, 1024] },
 *   ],
 * });
 *
 * viewport.addLayer(layer);
 * ```
 *
 * @see {@link VolumeLayer} for 3D volume rendering of the same data.
 *
 * @group Layers
 */
export class ImageLayer extends Layer implements ChannelsEnabled {
  /** Identifies the layer type as `ImageLayer`. */
  public readonly type = "ImageLayer";

  private readonly source_: ChunkSource;
  private readonly sliceCoords_: SliceCoordinates;
  private axes_: SliceAxes;
  private planeRotation_: quat;
  private orientation_: SliceOrientation;
  private readonly onPickValue_?: (info: PointPickingResult) => void;
  private readonly visibleChunks_: Map<Chunk, ImageRenderable> = new Map();
  private orderedChunks_: Chunk[] = [];
  private readonly pool_ = new RenderablePool<ImageRenderable>();
  private readonly initialChannelProps_?: ChannelProps[];
  private readonly channelChangeCallbacks_: (() => void)[] = [];
  private policy_: ImageSourcePolicy;
  private channelProps_?: ChannelProps[];
  private chunkStoreView_?: ChunkStoreView;
  private context_?: IdetikContext;
  private pointerDownPos_: vec2 | null = null;
  private debugMode_ = false;

  private static readonly STALE_PRESENTATION_MS_ = 1000;
  private lastPresentationTimeStamp_?: DOMHighResTimeStamp;
  private lastPresentationTimeCoord_?: number;

  private readonly wireframeColors_ = [
    new Color(0.6, 0.3, 0.3),
    new Color(0.3, 0.6, 0.4),
    new Color(0.4, 0.4, 0.7),
    new Color(0.6, 0.5, 0.3),
  ];

  /**
   * Creates an image layer for the given source and slice.
   *
   * @param props - Initialization properties.
   */
  constructor({
    source,
    sliceCoords,
    policy,
    orientation,
    channelProps,
    onPickValue,
    ...layerOptions
  }: ImageLayerProps) {
    super({ blendMode: "additive", occludes: true, ...layerOptions });
    this.setState("initialized");
    this.source_ = source;
    this.policy_ = policy ?? createExplorationPolicy();
    this.sliceCoords_ = sliceCoords;
    this.orientation_ = orientation ?? "XY";
    this.axes_ = sliceAxesFor(this.orientation_);
    this.planeRotation_ = orientationRotation(this.axes_);
    this.channelProps_ = channelProps;
    this.initialChannelProps_ = channelProps;
    this.onPickValue_ = onPickValue;
  }

  /** @hidden */
  protected attach(context: IdetikContext) {
    this.context_ = context;
    this.chunkStoreView_ = context.chunkManager.addView(
      this.source_,
      this.policy_,
      this.axes_
    );

    validateChannelPropsCount(
      this.channelProps_,
      this.chunkStoreView_.channelCount
    );
  }

  /** @hidden */
  protected detach(_context: IdetikContext) {
    this.releaseAndRemoveChunks(this.visibleChunks_.keys());
    this.orderedChunks_ = [];
    this.clearObjects();
    this.chunkStoreView_?.dispose();
    this.chunkStoreView_ = undefined;
    this.context_ = undefined;
  }

  /**
   * Streams chunks for the current view and refreshes the visible slice.
   *
   * @param viewport - The viewport being rendered.
   */
  public update(viewport?: Viewport): boolean {
    if (!viewport || !this.chunkStoreView_) return true;

    const camera = viewport.camera;

    // non-orthographic viewports have no world-space view rect, so we load the
    // whole slice plane and pick LOD as if it spanned the viewport. stopgap
    // until view-dependent LOD selection and culling work under perspective.
    const worldViewRect =
      camera.type === "OrthographicCamera"
        ? (camera as OrthographicCamera).getWorldViewRect()
        : this.chunkStoreView_.getWholePlaneRect();

    this.chunkStoreView_.updateChunksForImage(this.sliceCoords_, {
      worldViewRect,
      bufferWidthPx: viewport.getBufferRect().width,
    });

    this.updateChunks();

    for (const [chunk, imageRenderable] of this.visibleChunks_) {
      this.updateSlicePosition(imageRenderable, chunk);
    }
    return true;
  }

  /** The slice plane the layer displays. */
  public get orientation(): SliceOrientation {
    return this.orientation_;
  }

  /**
   * Changes the slice orientation at runtime. Visible renderables are
   * rebuilt for the new plane and chunks already resident in the shared
   * cache are reused.
   *
   * @param orientation - The new slice plane.
   */
  public setOrientation(orientation: SliceOrientation) {
    if (orientation === this.orientation_) {
      return;
    }

    this.releaseAndRemoveChunks(this.visibleChunks_.keys());
    this.orderedChunks_ = [];
    this.clearObjects();
    this.chunkStoreView_?.dispose();
    this.lastPresentationTimeStamp_ = undefined;
    this.lastPresentationTimeCoord_ = undefined;
    this.orientation_ = orientation;
    this.axes_ = sliceAxesFor(orientation);
    this.planeRotation_ = orientationRotation(this.axes_);

    if (!this.context_) {
      return;
    }

    this.chunkStoreView_ = this.context_.chunkManager.addView(
      this.source_,
      this.policy_,
      this.axes_
    );
  }

  private updateChunks() {
    if (!this.chunkStoreView_) return;
    if (this.state !== "ready") this.setState("ready");

    const visibleChunksResident = Array.from(this.visibleChunks_.keys()).every(
      (chunk) => chunk.texture !== undefined
    );

    if (
      this.visibleChunks_.size > 0 &&
      visibleChunksResident &&
      !this.chunkStoreView_.hasCompleteVisibleLOD() &&
      !this.isPresentationStale()
    ) {
      return;
    }
    this.lastPresentationTimeStamp_ = performance.now();
    this.lastPresentationTimeCoord_ = this.sliceCoords_.t;

    const orderedByLOD = this.chunkStoreView_.getChunksToRender();
    const current = new Set(orderedByLOD);
    const nonVisibleChunks = Array.from(this.visibleChunks_.keys()).filter(
      (chunk) => !current.has(chunk)
    );
    this.releaseAndRemoveChunks(nonVisibleChunks);

    for (const chunk of orderedByLOD) {
      this.visibleChunks_.set(
        chunk,
        this.getImageForChunk(chunk, chunk.texture!)
      );
    }
    this.orderedChunks_ = orderedByLOD;
    this.rebuildRenderGroups();
  }

  private rebuildRenderGroups() {
    this.clearObjects();
    for (const chunk of this.orderedChunks_) {
      const image = this.visibleChunks_.get(chunk);
      const channel = chunk.chunkIndex.c;
      if (
        image === undefined ||
        this.channelProps_?.[channel]?.visible === false
      )
        continue;
      this.addObject(image, channel);
    }
  }

  /** The `t` coordinate of the most recently presented slice. */
  public get lastPresentationTimeCoord(): number | undefined {
    return this.lastPresentationTimeCoord_;
  }

  private isPresentationStale(): boolean {
    if (this.lastPresentationTimeStamp_ === undefined) return false;
    return (
      performance.now() - this.lastPresentationTimeStamp_ >
      ImageLayer.STALE_PRESENTATION_MS_
    );
  }

  /**
   * Handles click picking for `onPickValue`. Called automatically for
   * each pointer event.
   *
   * @param event - The event with clip and world coordinates attached.
   */
  public onEvent(event: EventContext) {
    this.pointerDownPos_ = handlePointPickingEvent(
      event,
      this.pointerDownPos_,
      (ray) => this.pickAtRay(ray),
      this.onPickValue_
    );
  }

  private async pickAtRay(ray: Ray): Promise<PointPickingResult | null> {
    const firstChunk = this.visibleChunks_.values().next();
    if (firstChunk.done) return null;

    const transform = firstChunk.value.transform;
    const planeNormal = vec3.transformQuat(
      vec3.create(),
      vec3.fromValues(0, 0, 1),
      transform.rotation
    );

    const plane = Plane.fromPointAndNormal(transform.translation, planeNormal);
    const world = ray.intersectWithPlane(plane);
    if (!world) return null;

    const value = await this.getValueAtWorld(world);
    if (value === null) return null;

    return { world, value };
  }

  /** @hidden */
  public get chunkStoreView(): ChunkStoreView | undefined {
    return this.chunkStoreView_;
  }

  /**
   * The slice coordinates the layer displays. This is the object passed
   * at construction and may be mutated to move through the data.
   */
  public get sliceCoords(): SliceCoordinates {
    return this.sliceCoords_;
  }

  /** The chunked image source the layer streams from. */
  public get source(): ChunkSource {
    return this.source_;
  }

  /**
   * The streaming policy in effect. Assign a new policy to reschedule
   * loading at runtime, for example when switching between exploration
   * and playback.
   */
  public get imageSourcePolicy(): Readonly<ImageSourcePolicy> {
    return this.policy_;
  }

  /** @param newPolicy - The policy to apply. */
  public set imageSourcePolicy(newPolicy: ImageSourcePolicy) {
    if (this.policy_ !== newPolicy) {
      this.policy_ = newPolicy;
      if (this.chunkStoreView_) {
        this.chunkStoreView_.setImageSourcePolicy(
          newPolicy,
          INTERNAL_POLICY_KEY
        );
      }
    }
  }

  private getImageForChunk(chunk: Chunk, texture: Texture) {
    const existing = this.visibleChunks_.get(chunk);
    if (existing) return existing;

    const pooled = this.pool_.acquire(
      poolKeyForImageRenderable(chunk, this.axes_)
    );
    if (pooled) {
      pooled.setTexture(0, texture);
      pooled.setChannelProps(this.getChannelPropsForChunk(chunk));
      this.updateImageChunk(pooled, chunk);
      return pooled;
    }

    return this.createImage(chunk, texture);
  }

  private getChannelPropsForChunk(chunk: Chunk): ChannelProps[] {
    if (!this.channelProps_) return [{}];
    return [this.channelProps_[chunk.chunkIndex.c] ?? {}];
  }

  private createImage(chunk: Chunk, texture: Texture) {
    const image = new ImageRenderable({
      width: chunk.shape[this.axes_.u],
      height: chunk.shape[this.axes_.v],
      texture,
      channelProps: this.getChannelPropsForChunk(chunk),
    });
    this.updateImageChunk(image, chunk);
    return image;
  }

  private updateSlicePosition(image: ImageRenderable, chunk: Chunk) {
    const { u, v, w } = this.axes_;
    const translation = vec3.create();
    translation[AxisComponent[u]] = chunk.offset[u];
    translation[AxisComponent[v]] = chunk.offset[v];
    translation[AxisComponent[w]] = this.sliceCoords_[w] ?? chunk.offset[w];
    image.transform.setTranslation(translation);
  }

  private sliceIndexForChunk(chunk: Chunk): number {
    const w = this.axes_.w;
    const sliceValue = this.sliceCoords_[w];

    if (sliceValue === undefined) {
      return 0;
    }

    const local = (sliceValue - chunk.offset[w]) / chunk.scale[w];
    return clamp(Math.round(local), 0, chunk.shape[w] - 1);
  }

  private updateImageChunk(image: ImageRenderable, chunk: Chunk) {
    if (this.debugMode_) {
      image.wireframeEnabled = true;
      image.wireframeColor =
        this.wireframeColors_[chunk.lod % this.wireframeColors_.length];
    } else {
      image.wireframeEnabled = false;
    }
    const { u, v } = this.axes_;
    image.transform.setScale([chunk.scale[u], chunk.scale[v], 1]);
    image.transform.setRotation(this.planeRotation_);
    this.updateSlicePosition(image, chunk);
    image.worldToTexCoord = worldToTexCoordForChunk(chunk, this.axes_);
  }

  /**
   * Reads the data value at a world position from the resident chunks.
   * Prefers the current level of detail and falls back to other resident
   * levels.
   *
   * @param world - The world-space position to sample.
   * @returns The sampled value or `null` if no resident chunk covers it.
   */
  public async getValueAtWorld(world: vec3): Promise<number | null> {
    const currentLOD = this.chunkStoreView_?.currentLOD ?? 0;

    for (const preferCurrentLOD of [true, false]) {
      for (const [chunk, image] of this.visibleChunks_) {
        if ((chunk.lod === currentLOD) !== preferCurrentLOD) continue;
        const value = await this.readValueFromChunk(chunk, image, world);
        if (value !== null) return value;
      }
    }
    return null;
  }

  private async readValueFromChunk(
    chunk: Chunk,
    image: ImageRenderable,
    world: vec3
  ): Promise<number | null> {
    const localPos = vec3.transformMat4(
      vec3.create(),
      world,
      image.transform.inverse
    );

    const { u, v, w } = this.axes_;
    const uIdx = Math.floor(localPos[0]);
    const vIdx = Math.floor(localPos[1]);

    if (
      uIdx < 0 ||
      uIdx >= chunk.shape[u] ||
      vIdx < 0 ||
      vIdx >= chunk.shape[v]
    ) {
      return null;
    }

    const texel = { x: 0, y: 0, z: 0 };
    texel[u] = uIdx;
    texel[v] = vIdx;
    texel[w] = this.sliceIndexForChunk(chunk);
    return (
      (await image.textures[0].readTexel?.(texel.x, texel.y, texel.z)) ?? null
    );
  }

  /** Whether chunk wireframes are drawn colored by level of detail. */
  public get debugMode(): boolean {
    return this.debugMode_;
  }

  /** @param debug - Whether to draw chunk wireframes. */
  public set debugMode(debug: boolean) {
    this.debugMode_ = debug;
    this.visibleChunks_.forEach((image, chunk) => {
      image.wireframeEnabled = this.debugMode_;
      if (this.debugMode_) {
        image.wireframeColor =
          this.wireframeColors_[chunk.lod % this.wireframeColors_.length];
      }
    });
  }

  /** The current per-channel appearance settings. */
  public get channelProps(): ChannelProps[] | undefined {
    return this.channelProps_;
  }

  /**
   * Applies new per-channel appearance settings to all visible chunks
   * and notifies channel change callbacks.
   *
   * @param channelProps - One entry per source channel.
   */
  public setChannelProps(channelProps: ChannelProps[]) {
    this.channelProps_ = channelProps;
    this.visibleChunks_.forEach((image, chunk) => {
      image.setChannelProps(this.getChannelPropsForChunk(chunk));
    });
    this.rebuildRenderGroups();
    this.channelChangeCallbacks_.forEach((callback) => {
      callback();
    });
  }

  /** Restores the channel settings passed at construction. */
  public resetChannelProps(): void {
    if (this.initialChannelProps_ !== undefined) {
      this.setChannelProps(this.initialChannelProps_);
    }
  }

  /**
   * Registers a callback invoked after every channel settings change.
   *
   * @param callback - The callback to add.
   */
  public addChannelChangeCallback(callback: () => void): void {
    this.channelChangeCallbacks_.push(callback);
  }

  /**
   * Removes a previously registered channel change callback.
   *
   * @param callback - The callback to remove.
   */
  public removeChannelChangeCallback(callback: () => void): void {
    const index = this.channelChangeCallbacks_.indexOf(callback);
    if (index === -1) {
      throw new Error(`Callback to remove could not be found: ${callback}`);
    }
    this.channelChangeCallbacks_.splice(index, 1);
  }

  private releaseAndRemoveChunks(chunks: Iterable<Chunk>): void {
    for (const chunk of chunks) {
      const image = this.visibleChunks_.get(chunk);
      if (image) {
        this.pool_.release(poolKeyForImageRenderable(chunk, this.axes_), image);
        this.visibleChunks_.delete(chunk);
      }
    }
  }
}

export function poolKeyForImageRenderable(chunk: Chunk, axes: SliceAxes) {
  return [
    `plane${axes.u}${axes.v}`,
    `lod${chunk.lod}`,
    `shape${chunk.shape.x}x${chunk.shape.y}x${chunk.shape.z}`,
    `align${chunk.rowAlignmentBytes}`,
  ].join(":");
}
