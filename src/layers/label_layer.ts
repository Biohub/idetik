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
  LabelColorMapProps,
  LabelColorMap,
  validateColorMap,
  LabelImageRenderable,
} from "../objects/renderable/label_image_renderable";
import { Texture } from "../objects/textures/texture";
import { EventContext } from "../core/event_dispatcher";
import { Plane } from "../math/plane";
import { Ray } from "../math/ray";
import { quat, vec2, vec3 } from "gl-matrix";
import { handlePointPickingEvent, PointPickingResult } from "./point_picking";
import { clamp } from "../utilities/clamp";
import { RenderablePool } from "../utilities/renderable_pool";
import { poolKeyForImageRenderable } from "./image_layer";

/**
 * Initialization properties for constructing a label layer.
 */
export type LabelLayerProps = {
  /** The single-channel label source to stream from. */
  source: ChunkSource;
  /** The slice to display in world units. */
  sliceCoords: SliceCoordinates;
  /** Streaming policy. Defaults to the exploration policy. */
  policy?: ImageSourcePolicy;
  /** Slice plane orientation. Defaults to `"XY"`. */
  orientation?: SliceOrientation;
  /** Colors for label values. Defaults to a built-in cycle. */
  colorMap?: LabelColorMapProps;
  /** Called with the picked label when the layer is clicked. */
  onPickValue?: (info: PointPickingResult) => void;
  /** Outlines the picked label. Defaults to `false`. */
  outlineSelected?: boolean;
  /** Layer opacity in `[0, 1]`. Defaults to `1`. */
  opacity?: number;
  /** How the layer blends. Defaults to `"none"`. */
  blendMode?: BlendMode;
  /** Hides content behind. Inferred from `blendMode`. */
  occludes?: boolean;
};

/**
 * A layer that renders a 2D slice of a single-channel label image.
 *
 * Label layer displays segmentation data where each pixel holds an
 * integer label. Labels are colored by cycling through the color map's
 * `cycle` with exact-value overrides in its `lookupTable`. Chunks stream
 * through the same policy machinery as {@link ImageLayer} and the source
 * must be single channel.
 *
 * Clicking the layer picks the label under the pointer. With
 * `outlineSelected` the picked label is outlined, and `onPickValue`
 * receives the world position and label value for custom handling such as
 * highlighting through {@link setColorMap}.
 *
 * ```ts
 * const labels = new LabelLayer({
 *   source: labelSource,
 *   sliceCoords: { z: 12, c: [0] },
 *   opacity: 0.55,
 *   blendMode: "normal",
 *   onPickValue: ({ value }) => console.log(`label ${value}`),
 * });
 *
 * viewport.addLayer(labels);
 * ```
 *
 * @group Layers
 */
export class LabelLayer extends Layer {
  /** Identifies the layer type as `LabelLayer`. */
  public readonly type = "LabelLayer";

  private readonly source_: ChunkSource;
  private readonly sliceCoords_: SliceCoordinates;
  private axes_: SliceAxes;
  private planeRotation_: quat;
  private orientation_: SliceOrientation;
  private readonly onPickValue_?: (info: PointPickingResult) => void;
  private readonly outlineSelected_: boolean;
  private readonly visibleChunks_: Map<Chunk, LabelImageRenderable> = new Map();
  private readonly pool_ = new RenderablePool<LabelImageRenderable>();
  private colorMap_: LabelColorMap;
  private selectedValue_: number | null = null;
  private policy_: ImageSourcePolicy;
  private chunkStoreView_?: ChunkStoreView;
  private context_?: IdetikContext;
  private pointerDownPos_: vec2 | null = null;

  private static readonly STALE_PRESENTATION_MS_ = 1000;
  private lastPresentationTimeStamp_?: DOMHighResTimeStamp;
  private lastPresentationTimeCoord_?: number;

  /**
   * Creates a label layer for the given source and slice.
   *
   * @param props - Initialization properties.
   */
  constructor({
    source,
    sliceCoords,
    policy,
    orientation,
    colorMap = {},
    onPickValue,
    outlineSelected = false,
    ...layerOptions
  }: LabelLayerProps) {
    super(layerOptions);
    this.setState("initialized");
    this.source_ = source;
    this.policy_ = policy ?? createExplorationPolicy();
    this.sliceCoords_ = sliceCoords;
    this.orientation_ = orientation ?? "XY";
    this.axes_ = sliceAxesFor(this.orientation_);
    this.planeRotation_ = orientationRotation(this.axes_);
    this.colorMap_ = validateColorMap(colorMap);
    this.onPickValue_ = onPickValue;
    this.outlineSelected_ = outlineSelected;
  }

  /** @hidden */
  protected attach(context: IdetikContext) {
    this.context_ = context;
    this.chunkStoreView_ = context.chunkManager.addView(
      this.source_,
      this.policy_,
      this.axes_
    );

    if (this.chunkStoreView_.channelCount > 1) {
      throw new Error(
        `LabelLayer does not support multi-channel sources ` +
          `(found ${this.chunkStoreView_.channelCount} channels). ` +
          `Label data must be single-channel.`
      );
    }
  }

  /** @hidden */
  protected detach(_context: IdetikContext) {
    this.releaseAndRemoveChunks(this.visibleChunks_.keys());
    this.clearObjects();
    this.chunkStoreView_?.dispose();
    this.chunkStoreView_ = undefined;
    this.context_ = undefined;
  }

  /**
   * Streams chunks for the current view and refreshes the visible slice.
   * Called automatically once per frame.
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

    for (const [chunk, labelRenderable] of this.visibleChunks_) {
      this.updateSlicePosition(labelRenderable, chunk);
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

    this.clearObjects();
    // one coverage group; labels are single-channel but may be multi-scale
    for (const chunk of orderedByLOD) {
      const label = this.getLabelForChunk(chunk, chunk.texture!);
      this.visibleChunks_.set(chunk, label);
      this.addObject(label, 0);
    }
  }

  private isPresentationStale(): boolean {
    if (this.lastPresentationTimeStamp_ === undefined) return false;
    return (
      performance.now() - this.lastPresentationTimeStamp_ >
      LabelLayer.STALE_PRESENTATION_MS_
    );
  }

  /**
   * Handles click picking and selection outlining. Called automatically
   * for each pointer event on the owning viewport.
   *
   * @param event - The event with clip and world coordinates attached.
   */
  public onEvent(event: EventContext) {
    this.pointerDownPos_ = handlePointPickingEvent(
      event,
      this.pointerDownPos_,
      (ray) => this.pickAtRay(ray),
      this.outlineSelected_
        ? (info: PointPickingResult) => {
            this.setSelectedValue(info.value);
            this.onPickValue_?.(info);
          }
        : this.onPickValue_
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

  /** The validated color map currently in effect. */
  public get colorMap(): LabelColorMap {
    return this.colorMap_;
  }

  /**
   * Replaces the color map and recolors all visible chunks.
   *
   * @param colorMap - Colors for label values. Omitted fields fall back
   *   to defaults.
   */
  public setColorMap(colorMap: LabelColorMapProps) {
    this.colorMap_ = validateColorMap(colorMap);
    this.visibleChunks_.forEach((label) => {
      label.setColorMap(this.colorMap_);
    });
  }

  /**
   * Sets the label value drawn as selected or `null` to clear the
   * selection.
   *
   * @param value - The label value to select.
   */
  public setSelectedValue(value: number | null) {
    this.selectedValue_ = value;
    this.visibleChunks_.forEach((label) => {
      label.setSelectedValue(this.selectedValue_);
    });
  }

  /**
   * The slice coordinates the layer displays. This is the object passed
   * at construction and may be mutated to move through the data.
   */
  public get sliceCoords(): SliceCoordinates {
    return this.sliceCoords_;
  }

  /** The chunked label source the layer streams from. */
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

  /** @hidden */
  public get chunkStoreView(): ChunkStoreView | undefined {
    return this.chunkStoreView_;
  }

  /** The `t` coordinate of the most recently presented slice. */
  public get lastPresentationTimeCoord(): number | undefined {
    return this.lastPresentationTimeCoord_;
  }

  /**
   * Reads the label value at a world position from the resident chunks.
   * Prefers the current level of detail and falls back to other resident
   * levels.
   *
   * @param world - The world-space position to sample.
   * @returns The label value or `null` if no resident chunk covers it.
   */
  public async getValueAtWorld(world: vec3): Promise<number | null> {
    const currentLOD = this.chunkStoreView_?.currentLOD ?? 0;

    for (const preferCurrentLOD of [true, false]) {
      for (const [chunk, label] of this.visibleChunks_) {
        if ((chunk.lod === currentLOD) !== preferCurrentLOD) continue;
        const value = await this.readValueFromChunk(chunk, label, world);
        if (value !== null) return value;
      }
    }
    return null;
  }

  private async readValueFromChunk(
    chunk: Chunk,
    label: LabelImageRenderable,
    world: vec3
  ): Promise<number | null> {
    const localPos = vec3.transformMat4(
      vec3.create(),
      world,
      label.transform.inverse
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
      (await label.textures[0].readTexel?.(texel.x, texel.y, texel.z)) ?? null
    );
  }

  private getLabelForChunk(chunk: Chunk, texture: Texture) {
    const existing = this.visibleChunks_.get(chunk);
    if (existing) return existing;

    const pooled = this.pool_.acquire(
      poolKeyForImageRenderable(chunk, this.axes_)
    );
    if (pooled) {
      pooled.setTexture(0, texture);
      pooled.setColorMap(this.colorMap_);
      pooled.setSelectedValue(this.selectedValue_);
      this.updateLabelChunk(pooled, chunk);

      return pooled;
    }

    return this.createLabel(chunk, texture);
  }

  private createLabel(chunk: Chunk, texture: Texture) {
    const label = new LabelImageRenderable({
      width: chunk.shape[this.axes_.u],
      height: chunk.shape[this.axes_.v],
      imageData: texture,
      colorMap: this.colorMap_,
      outlineSelected: this.outlineSelected_,
      selectedValue: this.selectedValue_,
    });
    this.updateLabelChunk(label, chunk);
    return label;
  }

  private updateSlicePosition(label: LabelImageRenderable, chunk: Chunk) {
    const { u, v, w } = this.axes_;
    const translation = vec3.create();
    translation[AxisComponent[u]] = chunk.offset[u];
    translation[AxisComponent[v]] = chunk.offset[v];
    translation[AxisComponent[w]] = this.sliceCoords_[w] ?? chunk.offset[w];
    label.transform.setTranslation(translation);
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

  private updateLabelChunk(label: LabelImageRenderable, chunk: Chunk) {
    const { u, v } = this.axes_;
    label.transform.setScale([chunk.scale[u], chunk.scale[v], 1]);
    label.transform.setRotation(this.planeRotation_);
    this.updateSlicePosition(label, chunk);
    label.worldToTexCoord = worldToTexCoordForChunk(chunk, this.axes_);
  }

  private releaseAndRemoveChunks(chunks: Iterable<Chunk>): void {
    for (const chunk of chunks) {
      const label = this.visibleChunks_.get(chunk);
      if (label) {
        this.pool_.release(poolKeyForImageRenderable(chunk, this.axes_), label);
        this.visibleChunks_.delete(chunk);
      }
    }
  }
}
