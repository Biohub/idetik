import {
  Chunk,
  ChunkViewState,
  coordToIndex,
  SliceCoordinates,
  SourceDimension,
} from "./chunk";
import { AxisComponent, SliceAxes, SpatialAxis } from "../math/axes";
import type { ChunkStore } from "./chunk_store";
import { ImageSourcePolicy } from "../core/image_source_policy";
import { ReadonlyVec2, vec2, vec3, mat4 } from "gl-matrix";
import { Box2 } from "../math/box2";
import { Box3 } from "../math/box3";
import { Logger } from "../utilities/logger";
import { clamp } from "../utilities/clamp";

/*
Unique symbol used as a capability token to allow internal modules to update
the image source policy. Only code that imports this symbol can call
setImageSourcePolicy; all other callers will be rejected. Acts like a "friend"
access key, preventing accidental external mutation.
*/
export const INTERNAL_POLICY_KEY = Symbol("INTERNAL_POLICY_KEY");

// Box3 stores bounds as float32, so a bound exactly on a chunk edge can land
// just past it. In chunk-index units, this keeps it from adding a neighbour.
const CHUNK_EDGE_TOLERANCE = 1e-6;

export class ChunkStoreView {
  private readonly store_: ChunkStore;
  private policy_: ImageSourcePolicy;
  private policyChanged_ = false;
  private targetLOD_: number = 0;
  private readonly axes_: SliceAxes;
  private readonly scale0_: number;
  private mode_: "image" | "volume" | null = null;
  private lastViewBounds2D_: Box2 | null = null;
  private lastViewProjection_: mat4 | null = null;

  private lastSliceCoordW_?: number;
  private lastTCoord_?: number;
  private lastCCoords_?: number[];

  private readonly sourceMaxSquareDistance2D_: number;
  private readonly chunkViewStates_: Map<Chunk, ChunkViewState> = new Map();

  private isDisposed_ = false;

  constructor(
    store: ChunkStore,
    policy: ImageSourcePolicy,
    axes: SliceAxes = { u: "x", v: "y", w: "z" }
  ) {
    this.store_ = store;
    this.policy_ = policy;
    this.axes_ = axes;

    Logger.info(
      "ChunkStoreView",
      "Using image source policy:",
      this.policy_.profile
    );

    const dimensions = this.store_.dimensions;
    const uDim = dimensions[this.axes_.u];
    const vDim = dimensions[this.axes_.v];
    if (uDim === undefined || vDim === undefined) {
      throw new Error(
        `Source is missing dimensions for slice plane axes ` +
          `"${this.axes_.u}" and "${this.axes_.v}"`
      );
    }

    const uLod0 = uDim.lods[0];
    const vLod0 = vDim.lods[0];
    this.scale0_ = uLod0.scale;
    this.sourceMaxSquareDistance2D_ = vec2.squaredLength(
      vec2.fromValues(uLod0.size * uLod0.scale, vLod0.size * vLod0.scale)
    );
  }

  public get chunkViewStates(): ReadonlyMap<Chunk, ChunkViewState> {
    return this.chunkViewStates_;
  }

  public get isDisposed(): boolean {
    return this.isDisposed_;
  }

  public get lodCount(): number {
    return this.store_.lodCount;
  }

  public get channelCount(): number {
    return this.store_.channelCount;
  }

  public getWholePlaneRect(): Box2 {
    const dimensions = this.store_.dimensions;
    const uLod0 = dimensions[this.axes_.u]!.lods[0];
    const vLod0 = dimensions[this.axes_.v]!.lods[0];

    return new Box2(
      vec2.fromValues(uLod0.translation, vLod0.translation),
      vec2.fromValues(
        uLod0.translation + uLod0.size * uLod0.scale,
        vLod0.translation + vLod0.size * vLod0.scale
      )
    );
  }

  public getChunksToRender(): Chunk[] {
    const drawable =
      this.mode_ === "image"
        ? this.residentChunksForSlice()
        : this.residentChunksMarkedVisible();

    const targetLOD = this.targetLOD_;
    return drawable.sort(
      (a, b) =>
        Math.abs(a.lod - targetLOD) - Math.abs(b.lod - targetLOD) ||
        b.lod - a.lod
    );
  }

  private residentChunksMarkedVisible(): Chunk[] {
    const chunks: Chunk[] = [];
    for (const [chunk, state] of this.chunkViewStates_) {
      if (state.visible && chunk.state === "loaded" && chunk.texture) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  private residentChunksForSlice(): Chunk[] {
    const timeIndex = this.timeIndex(this.lastTCoord_);
    const channels = new Set(this.channelsOfInterest(this.lastCCoords_));
    const { min: minLOD, max: maxLOD } = this.lodRange();
    const visibleRegion = new VisibleSliceRegion(
      this.axes_,
      this.lastSliceCoordW_,
      this.lastViewBounds2D_!,
      this.store_.dimensions[this.axes_.w]
    );

    const chunks: Chunk[] = [];
    for (const chunk of this.store_.residentChunks) {
      if (chunk.lod < minLOD || chunk.lod > maxLOD) continue;
      if (chunk.chunkIndex.t !== timeIndex) continue;
      if (!channels.has(chunk.chunkIndex.c)) continue;
      if (!visibleRegion.contains(chunk)) continue;
      chunks.push(chunk);
    }
    return chunks;
  }

  public updateChunksForImage(
    sliceCoords: SliceCoordinates,
    view: { worldViewRect: Box2; bufferWidthPx: number }
  ): void {
    const viewBounds2D = view.worldViewRect;
    const virtualWidth = Math.abs(viewBounds2D.max[0] - viewBounds2D.min[0]);
    const virtualUnitsPerScreenPixel = virtualWidth / view.bufferWidthPx;
    const lodFactor = Math.log2(1 / virtualUnitsPerScreenPixel);

    const lodChanged = this.setLOD(lodFactor);

    const sliceBounds = this.getSliceAxisBounds(sliceCoords);
    const changed =
      this.policyChanged_ ||
      lodChanged ||
      this.viewBounds2DChanged(viewBounds2D) ||
      this.lastSliceCoordW_ !== sliceCoords[this.axes_.w] ||
      this.lastTCoord_ !== sliceCoords.t ||
      this.cCoordsChanged(sliceCoords.c);

    if (!changed) return;

    const currentTimeIndex = this.timeIndex(sliceCoords.t);
    if (!this.store_.hasChunksAtTime(currentTimeIndex)) {
      Logger.warn(
        "ChunkStoreView",
        "updateChunkViewStates called with no chunks initialized"
      );
      this.mode_ = null;
      this.chunkViewStates_.forEach(resetChunkViewState);
      return;
    }

    const viewBoundsCenter2D = vec2.create();
    vec2.lerp(viewBoundsCenter2D, viewBounds2D.min, viewBounds2D.max, 0.5);

    const viewBounds3D = this.makeViewBounds3D(viewBounds2D, sliceBounds);

    // reset all existing chunk view states to "not needed" to start
    // logic below will override this for chunks that are actually visible/prefetch
    this.chunkViewStates_.forEach(resetChunkViewState);

    const channels = this.channelsOfInterest(sliceCoords.c);
    const fallbackLOD = this.lodRange().max;
    const prefetchAabb = this.getPaddedBounds(viewBounds3D);
    const visibleRegion = new VisibleSliceRegion(
      this.axes_,
      sliceCoords[this.axes_.w],
      viewBounds2D,
      this.store_.dimensions[this.axes_.w]
    );

    // Range-query the prefetch AABB at currentLOD (and fallbackLOD when
    // distinct); fallback chunks act as a backdrop while currentLOD loads.
    const currentLOD = this.currentLOD;
    const lodsToVisit =
      currentLOD === fallbackLOD ? [currentLOD] : [currentLOD, fallbackLOD];
    for (const lod of lodsToVisit) {
      const isCurrent = lod === currentLOD;
      const isFallback = lod === fallbackLOD;
      this.iterateChunksInBox(
        currentTimeIndex,
        lod,
        channels,
        prefetchAabb,
        (chunk) => {
          const isInBounds = visibleRegion.contains(chunk);
          const prefetch = isCurrent && !isInBounds;
          const priority = this.computePriority(
            isFallback,
            isCurrent,
            isInBounds,
            prefetch,
            true
          );
          if (priority !== null) {
            this.chunkViewStates_.set(chunk, {
              visible: isInBounds,
              prefetch,
              priority,
              orderKey: this.squareDistance2D(chunk, viewBoundsCenter2D),
            });
          }
        }
      );
    }

    this.markTimeChunksForPrefetchImage(
      currentTimeIndex,
      sliceCoords,
      viewBounds3D,
      viewBoundsCenter2D
    );

    this.policyChanged_ = false;
    this.mode_ = "image";
    this.lastViewBounds2D_ = viewBounds2D.clone();
    this.lastSliceCoordW_ = sliceCoords[this.axes_.w];
    this.lastTCoord_ = sliceCoords.t;
    this.lastCCoords_ = sliceCoords.c ? [...sliceCoords.c] : undefined;
  }

  public updateChunksForVolume(
    sliceCoords: SliceCoordinates,
    viewProjection: mat4
  ): void {
    const changed =
      this.policyChanged_ ||
      this.hasViewProjectionChanged(viewProjection) ||
      this.lastTCoord_ !== sliceCoords.t ||
      this.cCoordsChanged(sliceCoords.c);

    if (!changed) return;

    const currentTimeIndex = this.timeIndex(sliceCoords.t);
    if (!this.store_.hasChunksAtTime(currentTimeIndex)) {
      Logger.warn(
        "ChunkStoreView",
        "updateChunksForVolume called with no chunks initialized"
      );
      this.mode_ = null;
      this.chunkViewStates_.forEach(resetChunkViewState);
      return;
    }

    // TODO: Calculate LOD dynamically based on view frustum for volume rendering
    // (similar to zoom-based LOD calculation in updateChunksForImage).
    // Currently uses a fixed LOD from policy.
    this.targetLOD_ = this.policy_.lod.min;

    this.chunkViewStates_.forEach(resetChunkViewState);

    const channels = this.channelsOfInterest(sliceCoords.c);
    const fallbackLOD = this.lodRange().max;
    const currentLOD = this.currentLOD;

    const markVolumeChunkVisible = (chunk: Chunk) => {
      const isFallbackLOD = chunk.lod === fallbackLOD;
      const isCurrentLOD = chunk.lod === currentLOD;
      const priority = this.computePriority(
        isFallbackLOD,
        isCurrentLOD,
        true,
        false,
        true
      );
      if (priority === null) return;
      this.chunkViewStates_.set(chunk, {
        visible: true,
        prefetch: false,
        priority,
        orderKey: 0,
      });
    };
    this.iterateAllChunksAtLod(
      currentTimeIndex,
      currentLOD,
      channels,
      markVolumeChunkVisible
    );
    if (currentLOD !== fallbackLOD) {
      this.iterateAllChunksAtLod(
        currentTimeIndex,
        fallbackLOD,
        channels,
        markVolumeChunkVisible
      );
    }

    this.markTimeChunksForPrefetchVolume(currentTimeIndex, sliceCoords);

    this.policyChanged_ = false;
    this.mode_ = "volume";
    this.lastTCoord_ = sliceCoords.t;
    this.lastCCoords_ = sliceCoords.c ? [...sliceCoords.c] : undefined;
    this.lastViewProjection_ = viewProjection;
  }

  public hasCompleteVisibleLOD(): boolean {
    return (
      this.allVisibleLoadedAt(this.lodRange().max) ||
      this.allVisibleLoadedAt(this.currentLOD)
    );
  }

  private allVisibleLoadedAt(lod: number): boolean {
    let foundAny = false;
    for (const [chunk, state] of this.chunkViewStates_) {
      if (!state.visible || chunk.lod !== lod) continue;
      foundAny = true;
      if (chunk.texture === undefined) return false;
    }
    return foundAny;
  }

  public get currentLOD(): number {
    const { min, max } = this.lodRange();
    return clamp(Math.round(this.targetLOD_), min, max);
  }

  public maybeForgetChunk(chunk: Chunk): void {
    const viewState = this.chunkViewStates_.get(chunk);
    if (
      viewState &&
      (viewState.visible || viewState.prefetch || viewState.priority !== null)
    ) {
      return;
    }
    this.chunkViewStates_.delete(chunk);
  }

  public dispose(): void {
    this.isDisposed_ = true;
    this.mode_ = null;
    this.chunkViewStates_.forEach(resetChunkViewState);
  }

  public setImageSourcePolicy(newPolicy: ImageSourcePolicy, key: symbol) {
    if (key !== INTERNAL_POLICY_KEY) {
      throw new Error("Unauthorized policy mutation");
    }

    if (this.policy_ !== newPolicy) {
      this.policy_ = newPolicy;
      this.policyChanged_ = true;

      Logger.info(
        "ChunkStoreView",
        "Using image source policy:",
        this.policy_.profile
      );
    }
  }

  private setLOD(lodFactor: number): boolean {
    // With 2x downsampling per LOD, selection happens in log2 space.
    const bias = this.policy_.lod.bias;

    // How many LOD 0 pixels per screen pixel, normalized by source scale.
    const sourceAdjusted = -Math.log2(this.scale0_) - lodFactor;
    const previousLOD = this.currentLOD;
    this.targetLOD_ = bias - 0.5 + sourceAdjusted;
    return this.currentLOD !== previousLOD;
  }

  private markTimeChunksForPrefetchImage(
    currentTimeIndex: number,
    sliceCoords: SliceCoordinates,
    viewBounds3D: Box3,
    viewBoundsCenter2D: ReadonlyVec2
  ): void {
    const numTimePoints = this.store_.dimensions.t?.lods[0].size ?? 1;
    const windowSize = Math.min(this.policy_.prefetch.t, numTimePoints - 1);
    const priority = this.policy_.priorityMap["prefetchTime"];
    const channels = this.channelsOfInterest(sliceCoords.c);

    for (let i = 1; i <= windowSize; ++i) {
      const t = (currentTimeIndex + i) % numTimePoints;
      this.iterateChunksInBox(
        t,
        this.currentLOD,
        channels,
        viewBounds3D,
        (chunk) => {
          const squareDistance = this.squareDistance2D(
            chunk,
            viewBoundsCenter2D
          );
          const normalizedDistance = clamp(
            squareDistance / this.sourceMaxSquareDistance2D_,
            0,
            1 - Number.EPSILON
          );
          const orderKey = i + normalizedDistance;

          this.chunkViewStates_.set(chunk, {
            visible: false,
            prefetch: true,
            priority,
            orderKey,
          });
        }
      );
    }
  }

  private markTimeChunksForPrefetchVolume(
    currentTimeIndex: number,
    sliceCoords: SliceCoordinates
  ) {
    const numTimePoints = this.store_.dimensions.t?.lods[0].size ?? 1;
    const windowSize = Math.min(this.policy_.prefetch.t, numTimePoints - 1);
    const priority = this.policy_.priorityMap["prefetchTime"];
    const channels = this.channelsOfInterest(sliceCoords.c);

    for (let i = 1; i <= windowSize; ++i) {
      const t = (currentTimeIndex + i) % numTimePoints;
      this.iterateAllChunksAtLod(t, this.currentLOD, channels, (chunk) => {
        const orderKey = i; // nearer along the playback loop first
        this.chunkViewStates_.set(chunk, {
          visible: false,
          prefetch: true,
          priority,
          orderKey,
        });
      });
    }
  }

  private computePriority(
    isFallbackLOD: boolean,
    isCurrentLOD: boolean,
    isVisible: boolean,
    isPrefetch: boolean,
    isChannelInSlice: boolean
  ) {
    if (!isChannelInSlice) return null;

    const m = this.policy_.priorityMap;
    if (isFallbackLOD && isVisible) return m["fallbackVisible"];
    if (isCurrentLOD && isVisible) return m["visibleCurrent"];
    if (isFallbackLOD) return m["fallbackBackground"];
    if (isCurrentLOD && isPrefetch) return m["prefetchSpace"];

    return null;
  }

  private channelsOfInterest(c: number[] | undefined): number[] {
    return c ?? Array.from({ length: this.store_.channelCount }, (_, i) => i);
  }

  // Half-open chunk-index range [min, max) at a given LOD that covers `bounds`.
  // Returns null if the bounds don't overlap the data grid.
  private chunkIndexRange(bounds: Box3, lod: number) {
    const dim = this.store_.dimensions;
    const xLod = dim.x.lods[lod];
    const yLod = dim.y.lods[lod];
    const zLod = dim.z?.lods[lod];

    const xCount = Math.ceil(xLod.size / xLod.chunkSize);
    const yCount = Math.ceil(yLod.size / yLod.chunkSize);
    const zCount = zLod ? Math.ceil(zLod.size / zLod.chunkSize) : 1;

    const xStride = xLod.chunkSize * xLod.scale;
    const yStride = yLod.chunkSize * yLod.scale;
    const zStride = zLod ? zLod.chunkSize * zLod.scale : 1;
    const xTran = xLod.translation;
    const yTran = yLod.translation;
    const zTran = zLod?.translation ?? 0;

    const xMin = Math.max(0, floorIndex((bounds.min[0] - xTran) / xStride));
    const xMax = Math.min(xCount, ceilIndex((bounds.max[0] - xTran) / xStride));
    const yMin = Math.max(0, floorIndex((bounds.min[1] - yTran) / yStride));
    const yMax = Math.min(yCount, ceilIndex((bounds.max[1] - yTran) / yStride));
    const zMin = zLod
      ? Math.max(0, floorIndex((bounds.min[2] - zTran) / zStride))
      : 0;
    const zMax = zLod
      ? Math.min(zCount, ceilIndex((bounds.max[2] - zTran) / zStride))
      : 1;

    if (xMin >= xMax || yMin >= yMax || zMin >= zMax) return null;
    return { xMin, xMax, yMin, yMax, zMin, zMax };
  }

  private iterateChunksInBox(
    timeIndex: number,
    lod: number,
    channels: number[],
    bounds: Box3,
    callback: (chunk: Chunk) => void
  ): void {
    const range = this.chunkIndexRange(bounds, lod);
    if (!range) return;
    for (const c of channels) {
      const grid = this.store_.getChunkGrid(lod, timeIndex, c);
      if (!grid) continue;
      for (let zi = range.zMin; zi < range.zMax; ++zi) {
        const yPlane = grid[zi];
        for (let yi = range.yMin; yi < range.yMax; ++yi) {
          const xRow = yPlane[yi];
          for (let xi = range.xMin; xi < range.xMax; ++xi) {
            const chunk = xRow[xi];
            callback(chunk);
          }
        }
      }
    }
  }

  private iterateAllChunksAtLod(
    timeIndex: number,
    lod: number,
    channels: number[],
    callback: (chunk: Chunk) => void
  ): void {
    for (const c of channels) {
      const grid = this.store_.getChunkGrid(lod, timeIndex, c);
      if (!grid) continue;
      for (const yPlane of grid) {
        for (const xRow of yPlane) {
          for (const chunk of xRow) {
            callback(chunk);
          }
        }
      }
    }
  }

  private lodRange(): { min: number; max: number } {
    const lowestResLOD = this.store_.getLowestResLOD();
    const min = Math.max(0, Math.min(lowestResLOD, this.policy_.lod.min));
    const max = Math.max(min, Math.min(lowestResLOD, this.policy_.lod.max));
    return { min, max };
  }

  private timeIndex(t: number | undefined): number {
    const tDim = this.store_.dimensions.t;
    if (t === undefined || tDim === undefined) return 0;
    return coordToIndex(tDim.lods[0], t);
  }

  private getSliceAxisBounds(sliceCoords: SliceCoordinates): [number, number] {
    const wDim = this.store_.dimensions[this.axes_.w];
    if (wDim === undefined) return [0, 1];

    const wLod = wDim.lods[this.currentLOD];

    // If slice coordinate is undefined, return bounds that encompass the whole axis (for volume rendering)
    const sliceValue = sliceCoords[this.axes_.w];
    if (sliceValue === undefined) {
      return [wLod.translation, wLod.translation + wLod.size * wLod.scale];
    }

    const wShape = wLod.size;
    const wScale = wLod.scale;
    const wTran = wLod.translation;
    const wPoint = Math.floor((sliceValue - wTran) / wScale);
    const chunkDepth = wLod.chunkSize;

    const wChunk = Math.max(
      0,
      Math.min(
        Math.floor(wPoint / chunkDepth),
        Math.ceil(wShape / chunkDepth) - 1
      )
    );

    return [
      wTran + wChunk * chunkDepth * wScale,
      wTran + (wChunk + 1) * chunkDepth * wScale,
    ];
  }

  private makeViewBounds3D(
    viewBounds2D: Box2,
    sliceBounds: [number, number]
  ): Box3 {
    const min = vec3.create();
    const max = vec3.create();
    min[AxisComponent[this.axes_.u]] = viewBounds2D.min[0];
    max[AxisComponent[this.axes_.u]] = viewBounds2D.max[0];
    min[AxisComponent[this.axes_.v]] = viewBounds2D.min[1];
    max[AxisComponent[this.axes_.v]] = viewBounds2D.max[1];
    min[AxisComponent[this.axes_.w]] = sliceBounds[0];
    max[AxisComponent[this.axes_.w]] = sliceBounds[1];
    return new Box3(min, max);
  }

  private viewBounds2DChanged(newBounds: Box2): boolean {
    return (
      this.lastViewBounds2D_ === null ||
      !vec2.equals(this.lastViewBounds2D_.min, newBounds.min) ||
      !vec2.equals(this.lastViewBounds2D_.max, newBounds.max)
    );
  }

  private hasViewProjectionChanged(viewProjection: mat4) {
    return (
      this.lastViewProjection_ === null ||
      !mat4.equals(this.lastViewProjection_, viewProjection)
    );
  }

  private cCoordsChanged(newC?: number[]): boolean {
    if (!this.lastCCoords_ && !newC) return false;
    if (!this.lastCCoords_ || !newC) return true;
    if (this.lastCCoords_.length !== newC.length) return true;
    return !this.lastCCoords_.every((v, i) => v === newC[i]);
  }

  private getPaddedBounds(bounds: Box3): Box3 {
    const { u, v, w } = this.axes_;
    const dimensions = this.store_.dimensions;
    const uLod = dimensions[u]!.lods[this.currentLOD];
    const vLod = dimensions[v]!.lods[this.currentLOD];
    const wLod = dimensions[w]?.lods[this.currentLOD];

    const pad = vec3.create();
    pad[AxisComponent[u]] =
      uLod.chunkSize * uLod.scale * this.policy_.prefetch.x;
    pad[AxisComponent[v]] =
      vLod.chunkSize * vLod.scale * this.policy_.prefetch.y;
    if (wLod) {
      pad[AxisComponent[w]] =
        wLod.chunkSize * wLod.scale * this.policy_.prefetch.z;
    }

    return new Box3(
      vec3.subtract(vec3.create(), bounds.min, pad),
      vec3.add(vec3.create(), bounds.max, pad)
    );
  }

  private squareDistance2D(chunk: Chunk, center: ReadonlyVec2): number {
    function axisCenter(axis: SpatialAxis) {
      return chunk.offset[axis] + 0.5 * chunk.shape[axis] * chunk.scale[axis];
    }

    const { u, v } = this.axes_;
    const du = axisCenter(u) - center[0];
    const dv = axisCenter(v) - center[1];

    return du * du + dv * dv;
  }
}

class VisibleSliceRegion {
  private readonly axes_: SliceAxes;
  private readonly viewRect_: Box2;
  private readonly chunkRect_ = new Box2();
  private readonly sliceCoordByLod_?: readonly number[];

  constructor(
    axes: SliceAxes,
    sliceCoordW: number | undefined,
    viewRect: Box2,
    wDim: SourceDimension | undefined
  ) {
    this.axes_ = axes;
    this.viewRect_ = viewRect;
    if (sliceCoordW !== undefined && wDim !== undefined) {
      this.sliceCoordByLod_ = wDim.lods.map((lod) =>
        clamp(
          sliceCoordW,
          lod.translation,
          lod.translation + (lod.size - 1) * lod.scale
        )
      );
    }
  }

  public contains(chunk: Chunk): boolean {
    const { u, v, w } = this.axes_;
    const sliceCoordW = this.sliceCoordByLod_?.[chunk.lod];
    if (
      sliceCoordW !== undefined &&
      (sliceCoordW < chunk.offset[w] || sliceCoordW >= chunkEnd(chunk, w))
    ) {
      return false;
    }

    this.chunkRect_.min[0] = chunk.offset[u];
    this.chunkRect_.min[1] = chunk.offset[v];
    this.chunkRect_.max[0] = chunkEnd(chunk, u);
    this.chunkRect_.max[1] = chunkEnd(chunk, v);
    return Box2.intersects(this.chunkRect_, this.viewRect_);
  }
}

function floorIndex(value: number): number {
  return Math.floor(value + CHUNK_EDGE_TOLERANCE);
}

function ceilIndex(value: number): number {
  return Math.ceil(value - CHUNK_EDGE_TOLERANCE);
}

function chunkEnd(chunk: Chunk, axis: SpatialAxis): number {
  return chunk.offset[axis] + chunk.shape[axis] * chunk.scale[axis];
}

function resetChunkViewState(state: ChunkViewState): void {
  state.visible = false;
  state.prefetch = false;
  state.priority = null;
  state.orderKey = null;
}
