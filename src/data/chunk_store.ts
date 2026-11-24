import { Chunk, ChunkViewState, SourceDimensionMap } from "./chunk";
import { SliceAxes } from "../math/axes";
import { almostEqual } from "../utilities/almost_equal";
import { Logger } from "../utilities/logger";
import { ChunkStoreView } from "./chunk_store_view";
import { ImageSourcePolicy } from "../core/image_source_policy";

// (lod, t, c, z, y, x) packed into one integer
export type ChunkKey = number;

export type ChunkPlacement = Pick<
  Chunk,
  "lod" | "shape" | "chunkIndex" | "scale" | "offset"
>;

interface LodGrid {
  chunksX: number;
  chunksY: number;
  chunksZ: number;
  chunkWidth: number;
  chunkHeight: number;
  chunkDepth: number;
  baseKey: number;
}

interface ChunkIndexRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export class ChunkStore {
  private readonly entries_ = new Map<ChunkKey, Chunk>();
  private readonly demand_ = new Map<ChunkKey, ChunkViewState>();
  private readonly grids_: LodGrid[] = [];
  private readonly chunksT_: number;
  private readonly chunksC_: number;
  private readonly lowestResLOD_: number;
  private readonly dimensions_: SourceDimensionMap;
  private readonly views_: ChunkStoreView[] = [];
  private hasHadViews_ = false;

  constructor(dimensions: SourceDimensionMap) {
    this.dimensions_ = dimensions;
    this.lowestResLOD_ = this.dimensions_.numLods - 1;

    this.validateXYScaleRatios();
    this.chunksT_ = this.getAndValidateTimeDimension().size;
    this.chunksC_ = this.getAndValidateChannelDimension().size;

    let baseKey = 0;
    for (let lod = 0; lod < this.dimensions_.numLods; ++lod) {
      const xLod = this.dimensions_.x.lods[lod];
      const yLod = this.dimensions_.y.lods[lod];
      const zLod = this.dimensions_.z?.lods[lod];
      const grid = {
        chunksX: Math.ceil(xLod.size / xLod.chunkSize),
        chunksY: Math.ceil(yLod.size / yLod.chunkSize),
        chunksZ: zLod ? Math.ceil(zLod.size / zLod.chunkSize) : 1,
        chunkWidth: xLod.chunkSize,
        chunkHeight: yLod.chunkSize,
        chunkDepth: zLod?.chunkSize ?? 1,
        baseKey,
      };
      this.grids_.push(grid);
      baseKey +=
        this.chunksT_ *
        this.chunksC_ *
        grid.chunksZ *
        grid.chunksY *
        grid.chunksX;
    }
    if (!Number.isSafeInteger(baseKey)) {
      throw new Error(`ChunkStore cannot index ${baseKey} chunks`);
    }
  }

  public keyOf(
    lod: number,
    t: number,
    c: number,
    z: number,
    y: number,
    x: number
  ): ChunkKey {
    const g = this.grids_[lod];
    if (
      g === undefined ||
      !inRange(t, this.chunksT_) ||
      !inRange(c, this.chunksC_) ||
      !inRange(z, g.chunksZ) ||
      !inRange(y, g.chunksY) ||
      !inRange(x, g.chunksX)
    ) {
      throw new RangeError(
        `Chunk index out of range: lod=${lod} t=${t} c=${c} z=${z} y=${y} x=${x}`
      );
    }
    return (
      g.baseKey +
      (((t * this.chunksC_ + c) * g.chunksZ + z) * g.chunksY + y) * g.chunksX +
      x
    );
  }

  public lodOfKey(key: ChunkKey): number {
    let lod = this.grids_.length - 1;
    while (lod > 0 && this.grids_[lod].baseKey > key) --lod;
    return lod;
  }

  public timeOfKey(key: ChunkKey): number {
    return this.indicesOf(key).t;
  }

  public getEntry(key: ChunkKey): Chunk | undefined {
    return this.entries_.get(key);
  }

  public get entries(): ReadonlyMap<ChunkKey, Chunk> {
    return this.entries_;
  }

  public get demand(): ReadonlyMap<ChunkKey, ChunkViewState> {
    return this.demand_;
  }

  public admit(key: ChunkKey, demand: ChunkViewState): Chunk {
    if (this.entries_.has(key)) {
      throw new Error(`Chunk ${key} is already admitted`);
    }
    const { lod, t, c, z, y, x } = this.indicesOf(key);
    const chunk: Chunk = {
      ...this.placement(lod, t, c, z, y, x),
      ...demand,
      state: "unloaded",
      rowAlignmentBytes: 1,
    };
    this.entries_.set(key, chunk);
    return chunk;
  }

  public retire(chunk: Chunk): void {
    const { t, c, z, y, x } = chunk.chunkIndex;
    this.entries_.delete(this.keyOf(chunk.lod, t, c, z, y, x));
  }

  public elementCount(key: ChunkKey): number {
    const { lod, z, y, x } = this.indicesOf(key);
    const shape = this.shape(lod, z, y, x);
    return shape.x * shape.y * shape.z;
  }

  public forEachChunkInRange(
    lod: number,
    t: number,
    c: number,
    range: ChunkIndexRange,
    callback: (key: ChunkKey, placement: ChunkPlacement) => void
  ): void {
    for (let z = range.zMin; z < range.zMax; ++z)
      for (let y = range.yMin; y < range.yMax; ++y)
        for (let x = range.xMin; x < range.xMax; ++x)
          callback(
            this.keyOf(lod, t, c, z, y, x),
            this.placement(lod, t, c, z, y, x)
          );
  }

  public forEachSpatialChunk(
    lod: number,
    t: number,
    c: number,
    callback: (key: ChunkKey, placement: ChunkPlacement) => void
  ): void {
    const { chunksX, chunksY, chunksZ } = this.grids_[lod];
    const range = {
      xMin: 0,
      xMax: chunksX,
      yMin: 0,
      yMax: chunksY,
      zMin: 0,
      zMax: chunksZ,
    };
    this.forEachChunkInRange(lod, t, c, range, callback);
  }

  private indicesOf(key: ChunkKey) {
    const lod = this.lodOfKey(key);
    const g = this.grids_[lod];
    let rest = key - g.baseKey;
    const x = rest % g.chunksX;
    rest = (rest - x) / g.chunksX;
    const y = rest % g.chunksY;
    rest = (rest - y) / g.chunksY;
    const z = rest % g.chunksZ;
    rest = (rest - z) / g.chunksZ;
    const c = rest % this.chunksC_;
    const t = (rest - c) / this.chunksC_;
    return { lod, t, c, z, y, x };
  }

  private shape(lod: number, z: number, y: number, x: number) {
    const xLod = this.dimensions_.x.lods[lod];
    const yLod = this.dimensions_.y.lods[lod];
    const zLod = this.dimensions_.z?.lods[lod];
    const { chunkWidth, chunkHeight, chunkDepth } = this.grids_[lod];
    return {
      x: Math.min(chunkWidth, xLod.size - x * chunkWidth),
      y: Math.min(chunkHeight, yLod.size - y * chunkHeight),
      z: Math.min(chunkDepth, (zLod?.size ?? 1) - z * chunkDepth),
      c: 1,
    };
  }

  private placement(
    lod: number,
    t: number,
    c: number,
    z: number,
    y: number,
    x: number
  ): ChunkPlacement {
    const xLod = this.dimensions_.x.lods[lod];
    const yLod = this.dimensions_.y.lods[lod];
    const zLod = this.dimensions_.z?.lods[lod];
    const { chunkWidth, chunkHeight, chunkDepth } = this.grids_[lod];
    return {
      lod,
      shape: this.shape(lod, z, y, x),
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

  public get residentChunks(): Chunk[] {
    return [...this.entries_.values()].filter(
      (chunk) => chunk.texture !== undefined
    );
  }

  public canDispose(): boolean {
    return this.hasHadViews_ && this.views_.length === 0;
  }

  public updateDemand(): void {
    const demand = this.demand_;
    demand.clear();
    for (const view of this.views_) {
      for (const [key, state] of view.chunkViewStates) {
        if (state.priority === null) continue;
        const other = demand.get(key);
        demand.set(key, other === undefined ? state : combine(other, state));
      }
    }

    for (const [key, chunk] of this.entries_) {
      Object.assign(chunk, demand.get(key) ?? UNWANTED);
    }

    this.removeDisposedViews();
  }

  private removeDisposedViews(): void {
    for (let i = this.views_.length - 1; i >= 0; i--) {
      if (this.views_[i].isDisposed) {
        this.views_.splice(i, 1);
      }
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

const UNWANTED: ChunkViewState = {
  visible: false,
  prefetch: false,
  priority: null,
  orderKey: null,
};

function inRange(i: number, size: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < size;
}

function combine(a: ChunkViewState, b: ChunkViewState): ChunkViewState {
  const best = b.priority! < a.priority! ? b : a;
  return {
    visible: a.visible || b.visible,
    prefetch: a.prefetch || b.prefetch,
    priority: best.priority,
    orderKey: best.orderKey,
  };
}
