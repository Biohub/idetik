import { Chunk, SourceDimensionMap } from "./chunk";
import { SliceAxes } from "../math/axes";
import { almostEqual } from "../utilities/almost_equal";
import { Logger } from "../utilities/logger";
import { ChunkStoreView } from "./chunk_store_view";
import { ImageSourcePolicy } from "../core/image_source_policy";
import { Texture } from "../objects/textures/texture";

export class ChunkStore {
  // Chunks indexed as chunks_[lod][t][c][z][y][x].
  private readonly chunks_: Chunk[][][][][][];
  private readonly lowestResLOD_: number;
  private readonly dimensions_: SourceDimensionMap;
  private readonly views_: ChunkStoreView[] = [];
  private hasHadViews_ = false;
  private readonly resident_ = new Set<Chunk>();

  constructor(dimensions: SourceDimensionMap) {
    this.dimensions_ = dimensions;
    this.lowestResLOD_ = this.dimensions_.numLods - 1;

    this.validateXYScaleRatios();
    const { size: chunksT } = this.getAndValidateTimeDimension();
    const { size: chunksC } = this.getAndValidateChannelDimension();

    const numLods = this.dimensions_.numLods;
    this.chunks_ = new Array(numLods);

    for (let lod = 0; lod < numLods; ++lod) {
      const xLod = this.dimensions_.x.lods[lod];
      const yLod = this.dimensions_.y.lods[lod];
      const zLod = this.dimensions_.z?.lods[lod];

      const chunkWidth = xLod.chunkSize;
      const chunkHeight = yLod.chunkSize;
      const chunkDepth = zLod?.chunkSize ?? 1;

      const chunksX = Math.ceil(xLod.size / chunkWidth);
      const chunksY = Math.ceil(yLod.size / chunkHeight);
      const chunksZ = zLod ? Math.ceil(zLod.size / chunkDepth) : 1;

      const lodArr: Chunk[][][][][] = new Array(chunksT);
      this.chunks_[lod] = lodArr;
      for (let t = 0; t < chunksT; ++t) {
        const tArr: Chunk[][][][] = new Array(chunksC);
        lodArr[t] = tArr;
        for (let c = 0; c < chunksC; ++c) {
          const cArr: Chunk[][][] = new Array(chunksZ);
          tArr[c] = cArr;
          for (let z = 0; z < chunksZ; ++z) {
            const zOffset =
              zLod !== undefined
                ? zLod.translation + z * chunkDepth * zLod.scale
                : 0;
            const yArr: Chunk[][] = new Array(chunksY);
            cArr[z] = yArr;
            for (let y = 0; y < chunksY; ++y) {
              const yOffset = yLod.translation + y * chunkHeight * yLod.scale;
              const xArr: Chunk[] = new Array(chunksX);
              yArr[y] = xArr;
              for (let x = 0; x < chunksX; ++x) {
                const xOffset = xLod.translation + x * chunkWidth * xLod.scale;
                xArr[x] = {
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
                  scale: {
                    x: xLod.scale,
                    y: yLod.scale,
                    z: zLod?.scale ?? 1,
                  },
                  offset: {
                    x: xOffset,
                    y: yOffset,
                    z: zOffset,
                  },
                };
              }
            }
          }
        }
      }
    }
  }

  public getChunkGrid(
    lod: number,
    t: number,
    c: number
  ): Chunk[][][] | undefined {
    return this.chunks_[lod]?.[t]?.[c];
  }

  public get timepointCount(): number {
    return this.dimensions_.t?.lods[0].size ?? 1;
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
