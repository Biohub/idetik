import { Chunk, ChunkSource, SliceCoordinates } from "../data/chunk";
import { Layer } from "../core/layer";
import { Camera } from "../objects/cameras/camera";
import { Viewport } from "../core/viewport";
import { VolumeRenderable } from "../objects/renderable/volume_renderable";
import type { IdetikContext } from "../idetik";
import { ChunkStoreView, INTERNAL_POLICY_KEY } from "../data/chunk_store_view";
import {
  createExplorationPolicy,
  ImageSourcePolicy,
} from "../core/image_source_policy";
import { RenderablePool } from "../utilities/renderable_pool";
import { vec3 } from "gl-matrix";
import {
  ChannelProps,
  ChannelsEnabled,
  validateChannelPropsCount,
} from "../core/channel";

/**
 * Initialization properties for constructing a volume layer.
 */
export type VolumeLayerProps = {
  /** The chunked image source to stream from. */
  source: ChunkSource;
  /** Selects `t` and `c`. Spatial axes are ignored. */
  sliceCoords: SliceCoordinates;
  /** Streaming policy. Defaults to the exploration policy. */
  policy?: ImageSourcePolicy;
  /** Per-channel appearance. Length must match the source. */
  channelProps?: ChannelProps[];
};

const INTERACTIVE_STEP_SIZE_SCALE = 2.0;

/**
 * A layer that renders a chunked multi-channel image source as a 3D
 * volume.
 *
 * Volume layer ray marches the loaded chunks with premultiplied blending
 * and composites all visible channels in a single pass. The volume renders
 * at a single level of detail taken from the policy's `lod.min`, so pin
 * one with the policy when constructing the layer. While the camera moves
 * the ray march step size is doubled to keep interaction responsive.
 *
 * ```ts
 * const source = await OmeZarrImageSource.fromHttp({ url });
 *
 * const layer = new VolumeLayer({
 *   source,
 *   sliceCoords: { t: 0, c: undefined },
 *   policy: createExplorationPolicy({ lod: { min: 2, max: 2 } }),
 *   channelProps: [
 *     { color: "#00ffff", contrastLimits: [300, 1500] },
 *     { color: "#ff00ff", contrastLimits: [75, 500] },
 *   ],
 * });
 *
 * viewport.addLayer(layer);
 * ```
 *
 * @see {@link ImageLayer} for 2D slicing of the same data.
 *
 * @group Layers
 */
export class VolumeLayer extends Layer implements ChannelsEnabled {
  /** Identifies the layer type as `VolumeLayer`. */
  public readonly type = "VolumeLayer";

  /** Highlights rays of zero length for debugging. Defaults to `false`. */
  public debugShowDegenerateRays = false;

  /** Ray march step size relative to voxel size. Defaults to `1`. */
  public relativeStepSize = 1.0;

  /** Scales sample opacity during compositing. Defaults to `1`. */
  public opacityMultiplier = 1.0;

  /** Alpha where a ray stops early. Defaults to `0.99`. */
  public earlyTerminationAlpha = 0.99;

  /** Volume ray marching reads scene depth to composite with occluding layers. */
  protected override requiresSceneDepth_ = true;

  private readonly source_: ChunkSource;
  private readonly sliceCoords_: SliceCoordinates;
  private readonly currentVolumes_: Map<string, VolumeRenderable> = new Map();
  private readonly volumeToPoolKey_: Map<VolumeRenderable, string> = new Map();
  private readonly pool_ = new RenderablePool<VolumeRenderable>();
  private readonly initialChannelProps_?: ChannelProps[];
  private readonly channelChangeCallbacks_: Array<() => void> = [];
  private policy_: ImageSourcePolicy;
  private chunkStoreView_?: ChunkStoreView;
  private channelProps_?: ChannelProps[];

  private lastLoadedTime_: number | undefined = undefined;
  private lastNumRenderedChannelChunks_: number | undefined = undefined;
  private interactiveStepSizeScale_ = 1.0;

  // TODO: Make a debug config object to manage debug options
  private debugShowWireframes_ = false;

  /** Whether chunk bounding wireframes are drawn for debugging. */
  public get debugShowWireframes() {
    return this.debugShowWireframes_;
  }

  /** @param value - Whether to draw chunk wireframes. */
  public set debugShowWireframes(value: boolean) {
    if (this.debugShowWireframes_ === value) return;
    for (const volume of this.currentVolumes_.values()) {
      volume.wireframeEnabled = value;
    }
    this.debugShowWireframes_ = value;
  }

  /**
   * Sets the streaming policy at runtime and reschedules loading. The
   * volume renders the level of detail given by the policy's `lod.min`.
   *
   * @param newPolicy - The policy to apply.
   */
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

  /**
   * Applies new per-channel appearance settings to all visible volumes
   * and notifies channel change callbacks.
   *
   * @param channelProps - One entry per source channel.
   */
  public setChannelProps(channelProps: ChannelProps[]) {
    this.channelProps_ = channelProps;
    for (const volume of this.currentVolumes_.values()) {
      volume.setChannelProps(channelProps);
    }
    this.channelChangeCallbacks_.forEach((callback) => {
      callback();
    });
  }

  /** The current per-channel appearance settings. */
  public get channelProps(): ChannelProps[] | undefined {
    return this.channelProps_;
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

  /**
   * Creates a volume layer for the given source.
   *
   * @param props - Initialization properties.
   */
  constructor({ source, sliceCoords, policy, channelProps }: VolumeLayerProps) {
    super({ blendMode: "premultipliedOver" });
    this.source_ = source;
    this.sliceCoords_ = sliceCoords;
    this.policy_ = policy ?? createExplorationPolicy();
    this.initialChannelProps_ = channelProps;
    this.channelProps_ = channelProps;
    this.setState("initialized");
  }

  private getOrCreateVolume(key: string, chunks: Chunk[]): VolumeRenderable {
    const existing = this.currentVolumes_.get(key);
    if (existing) {
      for (const chunk of chunks) existing.updateVolumeWithChunk(chunk);
      return existing;
    }

    const poolKey = poolKeyForChunk(chunks[0]);
    const volume = this.pool_.acquire(poolKey) ?? new VolumeRenderable();
    volume.setChannelProps(this.channelProps_ ?? []);
    this.volumeToPoolKey_.set(volume, poolKey);

    for (const chunk of chunks) volume.updateVolumeWithChunk(chunk);
    this.updateVolumeTransform(volume, chunks[0]);
    return volume;
  }

  /** @hidden */
  protected attach(context: IdetikContext) {
    this.chunkStoreView_ = context.chunkManager.addView(
      this.source_,
      this.policy_
    );

    validateChannelPropsCount(
      this.channelProps_,
      this.chunkStoreView_.channelCount
    );
  }

  /** @hidden */
  protected detach(_context: IdetikContext) {
    for (const volume of this.currentVolumes_.values()) {
      this.releaseAndRemoveVolume(volume);
    }
    this.currentVolumes_.clear();
    this.clearObjects();
    this.chunkStoreView_?.dispose();
    this.chunkStoreView_ = undefined;
  }

  private updateChunks() {
    if (!this.chunkStoreView_) return;
    if (this.state !== "ready") this.setState("ready");

    const chunksToRender = this.chunkStoreView_.getChunksToRender();
    const currentTime = this.sliceCoords_.t ?? -1;
    const groupedChunks = groupBySpatialIndex(chunksToRender);

    const needsUpdate =
      this.lastLoadedTime_ !== currentTime ||
      groupedChunks.size !== this.currentVolumes_.size ||
      this.lastNumRenderedChannelChunks_ !== chunksToRender.length;
    if (!needsUpdate) return;

    for (const [key, volume] of this.currentVolumes_) {
      if (!groupedChunks.has(key)) {
        this.releaseAndRemoveVolume(volume);
        this.currentVolumes_.delete(key);
      }
    }

    for (const [key, chunks] of groupedChunks) {
      const volume = this.getOrCreateVolume(key, chunks);
      volume.wireframeEnabled = this.debugShowWireframes;
      this.currentVolumes_.set(key, volume);
    }

    this.lastLoadedTime_ = currentTime;
    this.lastNumRenderedChannelChunks_ = chunksToRender.length;
  }

  private updateVolumeTransform(volume: VolumeRenderable, chunk: Chunk) {
    const worldSize = {
      x: chunk.shape.x * chunk.scale.x,
      y: chunk.shape.y * chunk.scale.y,
      z: chunk.shape.z * chunk.scale.z,
    };
    volume.transform.setScale([worldSize.x, worldSize.y, worldSize.z]);
    vec3.set(volume.voxelScale, chunk.scale.x, chunk.scale.y, chunk.scale.z);
    const originOffset = {
      x: (chunk.shape.x * chunk.scale.x) / 2,
      y: (chunk.shape.y * chunk.scale.y) / 2,
      z: (chunk.shape.z * chunk.scale.z) / 2,
    };
    volume.transform.setTranslation([
      chunk.offset.x + originOffset.x,
      chunk.offset.y + originOffset.y,
      chunk.offset.z + originOffset.z,
    ]);
  }

  private releaseAndRemoveVolume(volume: VolumeRenderable) {
    volume.reset();
    this.pool_.release(this.volumeToPoolKey_.get(volume)!, volume);
    this.volumeToPoolKey_.delete(volume);
  }

  /**
   * Streams chunks for the current view and rebuilds the volume set
   * sorted front to back. Called automatically once per frame.
   *
   * @param viewport - The viewport being rendered.
   */
  public update(viewport?: Viewport): boolean {
    if (!viewport || !this.chunkStoreView_) return true;

    this.chunkStoreView_.updateChunksForVolume(
      this.sliceCoords_,
      viewport.camera.getViewProjection()
    );

    const isCameraMoving = viewport.cameraControls?.isMoving ?? false;
    this.interactiveStepSizeScale_ = isCameraMoving
      ? INTERACTIVE_STEP_SIZE_SCALE
      : 1.0;

    this.updateChunks();
    this.rebuildObjects(viewport.camera);
    return true;
  }

  private rebuildObjects(camera: Camera) {
    const volumes = Array.from(this.currentVolumes_.values());
    sortBackToFront(volumes, camera);

    this.clearObjects();
    for (const volume of volumes) {
      this.addObject(volume);
    }
  }

  /** @hidden */
  public get chunkStoreView(): ChunkStoreView | undefined {
    return this.chunkStoreView_;
  }

  /** Returns the ray marching uniforms for this layer. */
  public getUniforms(): Record<string, unknown> {
    return {
      u_debugShowDegenerateRays: Number(this.debugShowDegenerateRays),
      u_relativeStepSize:
        this.relativeStepSize * this.interactiveStepSizeScale_,
      u_opacityMultiplier: this.opacityMultiplier,
      u_earlyTerminationAlpha: this.earlyTerminationAlpha,
    };
  }
}

function spatialKey(chunk: Chunk): string {
  const { x, y, z, t } = chunk.chunkIndex;
  return `${x}:${y}:${z}:${t}`;
}

function groupBySpatialIndex(chunks: Chunk[]): Map<string, Chunk[]> {
  const grouped = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    const key = spatialKey(chunk);
    let group = grouped.get(key);
    if (!group) {
      group = [];
      grouped.set(key, group);
    }
    group.push(chunk);
  }
  return grouped;
}

export function poolKeyForChunk(chunk: Chunk) {
  return [
    `lod${chunk.lod}`,
    `shape${chunk.shape.x}x${chunk.shape.y}x${chunk.shape.z}`,
    `align${chunk.rowAlignmentBytes}`,
  ].join(":");
}

function sortBackToFront(objects: VolumeRenderable[], camera: Camera) {
  const cameraPosition = camera.position;
  const depths = new Map<VolumeRenderable, number>();

  for (const object of objects) {
    const center = object.transform.translation;
    depths.set(object, vec3.squaredDistance(cameraPosition, center));
  }

  objects.sort((a, b) => depths.get(b)! - depths.get(a)!);
}
