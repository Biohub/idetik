import { Chunk, SourceDimensionMap } from "./chunk";
import { SliceAxes } from "../math/axes";
import { almostEqual } from "../utilities/almost_equal";
import { Logger } from "../utilities/logger";
import { ChunkStoreView } from "./chunk_store_view";
import { ImageSourcePolicy } from "../core/image_source_policy";
import { Texture } from "../objects/textures/texture";

/** Per-LOD chunk grid geometry, from which any chunk descriptor follows. */
interface LodGeometry {
  chunksX: number;
  chunksY: number;
  chunksZ: number;
  chunkWidth: number;
  chunkHeight: number;
  chunkDepth: number;
}

/** A half-open range of chunk indices within one (lod, t, c) plane. */
export interface ChunkIndexRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export class ChunkStore {
  // Chunk descriptors are pure functions of their indices, so only the ones
  // something refers to exist: created on demand when a view touches them,
  // kept while queued, loading, loaded or resident, and dropped once nothing
  // needs them (releaseChunkIfUnused). A dense grid would be one descriptor
  // per chunk of the whole source across every LOD, timepoint and channel —
  // tens of millions, and gigabytes of heap, for a large stitched plate.
  // Keyed per (lod, t, c) plane, then by packed (z, y, x) within it.
  private readonly planes_ = new Map<number, Map<number, Chunk>>();
  private chunkCount_ = 0;
  private readonly geometry_: LodGeometry[];
  private readonly chunksT_: number;
  private readonly chunksC_: number;
  private readonly lowestResLOD_: number;
  private readonly dimensions_: SourceDimensionMap;
  private readonly views_: ChunkStoreView[] = [];
  private hasHadViews_ = false;
  private readonly resident_ = new Set<Chunk>();

  constructor(dimensions: SourceDimensionMap) {
    this.dimensions_ = dimensions;
    this.lowestResLOD_ = this.dimensions_.numLods - 1;

    this.validateXYScaleRatios();
    this.chunksT_ = this.getAndValidateTimeDimension().size;
    this.chunksC_ = this.getAndValidateChannelDimension().size;

    this.geometry_ = [];
    for (let lod = 0; lod < this.dimensions_.numLods; ++lod) {
      const xLod = this.dimensions_.x.lods[lod];
      const yLod = this.dimensions_.y.lods[lod];
      const zLod = this.dimensions_.z?.lods[lod];
      const chunkWidth = xLod.chunkSize;
      const chunkHeight = yLod.chunkSize;
      const chunkDepth = zLod?.chunkSize ?? 1;
      this.geometry_.push({
        chunksX: Math.ceil(xLod.size / chunkWidth),
        chunksY: Math.ceil(yLod.size / chunkHeight),
        chunksZ: zLod ? Math.ceil(zLod.size / chunkDepth) : 1,
        chunkWidth,
        chunkHeight,
        chunkDepth,
      });
    }
  }

  /** Chunk descriptors currently alive (touched, in flight, or resident). */
  public get chunkCount(): number {
    return this.chunkCount_;
  }

  /** Chunk counts along each axis at `lod`. */
  public chunkCounts(lod: number): { x: number; y: number; z: number } {
    const g = this.geometry_[lod];
    return { x: g.chunksX, y: g.chunksY, z: g.chunksZ };
  }

  /**
   * The chunk at these indices, created if it does not exist yet. The same
   * object is returned until it is released, so it can key per-view state.
   */
  public getChunk(
    lod: number,
    t: number,
    c: number,
    z: number,
    y: number,
    x: number
  ): Chunk {
    const g = this.geometry_[lod];
    const planeKey = (lod * this.chunksT_ + t) * this.chunksC_ + c;
    let plane = this.planes_.get(planeKey);
    if (!plane) {
      plane = new Map();
      this.planes_.set(planeKey, plane);
    }
    const key = (z * g.chunksY + y) * g.chunksX + x;
    let chunk = plane.get(key);
    if (!chunk) {
      chunk = this.createChunk(lod, t, c, z, y, x);
      plane.set(key, chunk);
      this.chunkCount_++;
    }
    return chunk;
  }

  /** Every chunk of the (lod, t, c) plane within `range`, created as needed. */
  public forEachChunkInRange(
    lod: number,
    t: number,
    c: number,
    range: ChunkIndexRange,
    callback: (chunk: Chunk) => void
  ): void {
    for (let z = range.zMin; z < range.zMax; ++z)
      for (let y = range.yMin; y < range.yMax; ++y)
        for (let x = range.xMin; x < range.xMax; ++x)
          callback(this.getChunk(lod, t, c, z, y, x));
  }

  /** Every chunk of the (lod, t, c) plane, created as needed. */
  public forEachChunkInPlane(
    lod: number,
    t: number,
    c: number,
    callback: (chunk: Chunk) => void
  ): void {
    const g = this.geometry_[lod];
    this.forEachChunkInRange(
      lod,
      t,
      c,
      {
        xMin: 0,
        xMax: g.chunksX,
        yMin: 0,
        yMax: g.chunksY,
        zMin: 0,
        zMax: g.chunksZ,
      },
      callback
    );
  }

  /**
   * Drop `chunk`'s descriptor if nothing needs it: no view tracks it, it is
   * not queued, loading, loaded or resident. Returns whether it was dropped.
   * It will be recreated, identical, if something touches it again.
   */
  public releaseChunkIfUnused(chunk: Chunk): boolean {
    if (
      chunk.state !== "unloaded" ||
      chunk.texture !== undefined ||
      chunk.data !== undefined
    )
      return false;
    for (const view of this.views_)
      if (view.chunkViewStates.has(chunk)) return false;
    const { t, c, z, y, x } = chunk.chunkIndex;
    const lod = chunk.lod;
    const g = this.geometry_[lod];
    const planeKey = (lod * this.chunksT_ + t) * this.chunksC_ + c;
    const plane = this.planes_.get(planeKey);
    const key = (z * g.chunksY + y) * g.chunksX + x;
    if (!plane || plane.get(key) !== chunk) return false;
    plane.delete(key);
    if (plane.size === 0) this.planes_.delete(planeKey);
    this.chunkCount_--;
    return true;
  }

  private createChunk(
    lod: number,
    t: number,
    c: number,
    z: number,
    y: number,
    x: number
  ): Chunk {
    const xLod = this.dimensions_.x.lods[lod];
    const yLod = this.dimensions_.y.lods[lod];
    const zLod = this.dimensions_.z?.lods[lod];
    const { chunkWidth, chunkHeight, chunkDepth } = this.geometry_[lod];
    return {
      state: "unloaded",
      lod,
      visible: false,
      prefetch: false,
      priority: null,
      orderKey: null,
      shape: {
        x: Math.min(chunkWidth, xLod.size - x * chunkWidth),
        y: Math.min(chunkHeight, yLod.size - y * chunkHeight),
        z: Math.min(chunkDepth, (zLod?.size ?? 1) - z * chunkDepth),
        c: 1,
      },
      rowAlignmentBytes: 1,
      chunkIndex: { x, y, z, c, t },
      scale: { x: xLod.scale, y: yLod.scale, z: zLod?.scale ?? 1 },
      offset: {
        x: xLod.translation + x * chunkWidth * xLod.scale,
        y: yLod.translation + y * chunkHeight * yLod.scale,
        z:
          zLod !== undefined
            ? zLod.translation + z * chunkDepth * zLod.scale
            : 0,
      },
    };
  }

  public hasChunksAtTime(timeIndex: number): boolean {
    return timeIndex >= 0 && timeIndex < this.chunksT_;
  }

  public get lodCount() {
    return this.lowestResLOD_ + 1;
  }

  public get channelCount(): number {
    return this.dimensions_.c?.lods[0].size ?? 1;
  }

  public get dimensions() {
    return this.dimensions_;
  }

  public getLowestResLOD(): number {
    return this.lowestResLOD_;
  }

  public addView(policy: ImageSourcePolicy, axes?: SliceAxes): ChunkStoreView {
    const view = new ChunkStoreView(this, policy, axes);
    this.views_.push(view);
    this.hasHadViews_ = true;
    return view;
  }

  public get views(): ReadonlyArray<ChunkStoreView> {
    return this.views_;
  }

  public get residentChunks(): ReadonlySet<Chunk> {
    return this.resident_;
  }

  public setChunkTexture(chunk: Chunk, texture: Texture): void {
    chunk.texture = texture;
    this.resident_.add(chunk);
  }

  public clearChunkTexture(chunk: Chunk): Texture | undefined {
    const texture = chunk.texture;
    chunk.texture = undefined;
    this.resident_.delete(chunk);
    return texture;
  }

  public canDispose(): boolean {
    return this.hasHadViews_ && this.views_.length === 0;
  }

  public updateAndCollectChunkChanges(): Set<Chunk> {
    const affectedChunks = new Set<Chunk>();
    for (const view of this.views_) {
      for (const [chunk, _viewState] of view.chunkViewStates) {
        affectedChunks.add(chunk);
      }
    }

    for (const chunk of affectedChunks) {
      this.aggregateChunkViewStates(chunk);
    }

    this.removeDisposedViews();

    return affectedChunks;
  }

  private removeDisposedViews(): void {
    for (let i = this.views_.length - 1; i >= 0; i--) {
      if (this.views_[i].isDisposed) {
        this.views_.splice(i, 1);
      }
    }
  }

  private aggregateChunkViewStates(chunk: Chunk): void {
    let anyVisible = false;
    let anyPrefetch = false;
    let minPriority: number | null = null;
    let orderKeyForMinPriority: number | null = null;

    for (const view of this.views_) {
      const viewState = view.chunkViewStates.get(chunk);
      if (!viewState) continue;

      if (viewState.visible) anyVisible = true;
      if (viewState.prefetch) anyPrefetch = true;

      if (viewState.priority !== null) {
        if (minPriority === null || viewState.priority < minPriority) {
          minPriority = viewState.priority;
          orderKeyForMinPriority = viewState.orderKey;
        }
      }

      if (
        !viewState.visible &&
        !viewState.prefetch &&
        viewState.priority === null
      ) {
        view.maybeForgetChunk(chunk);
      }
    }

    chunk.visible = anyVisible;
    chunk.prefetch = anyPrefetch;
    chunk.priority = minPriority;
    chunk.orderKey = orderKeyForMinPriority;

    const shouldEnqueueChunk =
      chunk.priority !== null && chunk.state === "unloaded";
    if (shouldEnqueueChunk) {
      chunk.state = "queued";
      return;
    }

    const shouldCancelQueuedChunk =
      chunk.priority === null && chunk.state === "queued";
    if (shouldCancelQueuedChunk) {
      chunk.state = "unloaded";
    }
  }

  private validateXYScaleRatios(): void {
    // Validates that each LOD level is downsampled by a factor of 2 in X and Y.
    // Z downsampling is not validated here because it's not guaranteed.
    const xDim = this.dimensions_.x;
    const yDim = this.dimensions_.y;
    for (let i = 1; i < this.dimensions_.numLods; i++) {
      const rx = xDim.lods[i].scale / xDim.lods[i - 1].scale;
      const ry = yDim.lods[i].scale / yDim.lods[i - 1].scale;

      if (!almostEqual(rx, 2, 0.02) || !almostEqual(ry, 2, 0.02)) {
        throw new Error(
          `Invalid downsampling factor between levels ${i - 1} → ${i}: ` +
            `expected (2× in X and Y), but got ` +
            `(${rx.toFixed(2)}×, ${ry.toFixed(2)}×) from scale ` +
            `[${xDim.lods[i - 1].scale}, ${yDim.lods[i - 1].scale}] → [${xDim.lods[i].scale}, ${yDim.lods[i].scale}]`
        );
      }
    }
  }

  private getAndValidateTimeDimension() {
    for (let lod = 0; lod < this.dimensions_.numLods; ++lod) {
      const tLod = this.dimensions_.t?.lods[lod];
      if (!tLod) continue;
      const prevTLod = this.dimensions_.t?.lods[lod - 1];
      if (!prevTLod) continue;
      if (tLod.size !== prevTLod.size) {
        throw new Error(
          `ChunkStore does not support downsampling in t. Found ${prevTLod.size} at LOD ${lod - 1} → ${tLod.size} at LOD ${lod}`
        );
      }
    }
    return {
      size: this.dimensions_.t?.lods[0].size ?? 1,
    };
  }

  private getAndValidateChannelDimension() {
    for (let lod = 0; lod < this.dimensions_.numLods; ++lod) {
      const cLod = this.dimensions_.c?.lods[lod];
      if (!cLod) continue;
      if (cLod.scale !== 1) {
        Logger.warn(
          "ChunkStore",
          `Idetik does not make use of non-unity scale in c. Found ${cLod.scale} at LOD ${lod}`
        );
      }
      if (cLod.translation !== 0) {
        throw new Error(
          `ChunkStore does not support translation in c. Found ${cLod.translation} at LOD ${lod}`
        );
      }
      const prevCLod = this.dimensions_.c?.lods[lod - 1];
      if (!prevCLod) continue;
      if (cLod.size !== prevCLod.size) {
        throw new Error(
          `ChunkStore does not support downsampling in c. Found ${prevCLod.size} at LOD ${lod - 1} → ${cLod.size} at LOD ${lod}`
        );
      }
    }
    return {
      size: this.dimensions_.c?.lods[0].size ?? 1,
    };
  }
}
