import { Chunk, ChunkSource, ChunkViewState } from "./chunk";
import { SliceAxes } from "../math/axes";
import { ChunkQueue, comparePriority } from "./chunk_queue";
import { chunkMemoryStats, clearChunkData } from "./chunk_memory";
import { ChunkKey, ChunkStore } from "./chunk_store";
import {
  computeSourceChunkStats,
  computeViewportChunkStats,
  SourceChunkStats,
  ViewportChunkStats,
} from "./chunk_stats";
import { ChunkStoreView } from "./chunk_store_view";
import { ImageSourcePolicy } from "../core/image_source_policy";
import { Texture, textureStorageBytes } from "../objects/textures/texture";
import { Texture3D } from "../objects/textures/texture_3d";
import { Logger } from "../utilities/logger";

/**
 * A snapshot of the chunk request queue.
 */
export type QueueStats = {
  /** Number of requests waiting to start. */
  pending: number;
  /** Number of requests currently in flight. */
  running: number;
  /** Number of loaded chunks waiting for GPU upload. */
  awaitingUpload: number;
};

const DEFAULT_MAX_CONCURRENT_REQUESTS = 8;
const DEFAULT_MAX_GPU_UPLOADS_PER_UPDATE = 4;

type WantedChunk = {
  source: ChunkSource;
  store: ChunkStore;
  key: ChunkKey;
  demand: ChunkViewState;
};

export class ChunkManager {
  private readonly stores_: { source: ChunkSource; store: ChunkStore }[] = [];
  private readonly queue_: ChunkQueue;

  private readonly uploadTexture_?: (texture: Texture) => void;
  private readonly disposeTexture_?: (texture: Texture) => void;
  private readonly getGpuResidentBytes_: () => number;
  private memoryLimitBytes_: number;
  private oversizedWarned_ = false;
  private readonly maxGpuUploadsPerUpdate_: number;

  constructor(
    uploadTexture?: (texture: Texture) => void,
    disposeTexture?: (texture: Texture) => void,
    getGpuResidentBytes: () => number = () => 0,
    memoryLimitBytes: number = Infinity,
    maxConcurrentRequests: number = DEFAULT_MAX_CONCURRENT_REQUESTS,
    maxGpuUploadsPerUpdate: number = DEFAULT_MAX_GPU_UPLOADS_PER_UPDATE
  ) {
    this.uploadTexture_ = uploadTexture;
    this.disposeTexture_ = disposeTexture;
    this.getGpuResidentBytes_ = getGpuResidentBytes;
    this.memoryLimitBytes_ = memoryLimitBytes;
    this.maxGpuUploadsPerUpdate_ = Math.max(1, maxGpuUploadsPerUpdate);
    this.queue_ = new ChunkQueue(maxConcurrentRequests);
  }

  public get memoryLimitBytes(): number {
    return this.memoryLimitBytes_;
  }

  public set memoryLimitBytes(value: number) {
    this.memoryLimitBytes_ = value;
  }

  public get queueStats(): QueueStats {
    return {
      pending: this.queue_.pendingCount,
      running: this.queue_.runningCount,
      awaitingUpload: this.awaitingUpload().length,
    };
  }

  public get memoryStats() {
    return chunkMemoryStats();
  }

  public get sourceChunkStats(): SourceChunkStats[] {
    return this.stores_.map(({ source, store }) =>
      computeSourceChunkStats(source, store)
    );
  }

  public viewportChunkStats(
    viewportId: string,
    views: readonly ChunkStoreView[]
  ): ViewportChunkStats {
    const withStores = views.flatMap((view) => {
      const store = this.stores_.find(({ store }) =>
        store.views.includes(view)
      )?.store;
      return store ? [{ view, store }] : [];
    });
    return computeViewportChunkStats(viewportId, withStores);
  }

  public addView(
    source: ChunkSource,
    policy: ImageSourcePolicy,
    axes?: SliceAxes
  ): ChunkStoreView {
    let store = this.stores_.find((s) => s.source === source)?.store;
    if (!store) {
      store = new ChunkStore(source.loader.getSourceDimensionMap());
      this.stores_.push({ source, store });
    }
    return store.addView(policy, axes);
  }

  public update() {
    const candidates: WantedChunk[] = [];

    for (const { source, store } of this.stores_) {
      store.updateDemand();

      for (const chunk of store.entries.values()) {
        if (chunk.priority === null) {
          this.releaseChunk(store, chunk);
        } else {
          chunk.releasedAt = undefined;
        }
      }

      for (const [key, demand] of store.demand) {
        const entry = store.getEntry(key);
        if (
          entry === undefined ||
          entry.state === "queued" ||
          entry.state === "unloaded"
        ) {
          candidates.push({ source, store, key, demand });
        }
      }
    }

    this.uploadLoadedChunks();

    this.enqueueWithinBudget(candidates);
    this.queue_.flush();

    for (let i = this.stores_.length - 1; i >= 0; i--) {
      const { store } = this.stores_[i];
      if (!store.canDispose()) continue;

      for (const chunk of store.residentChunks) {
        this.disposeChunkTexture(chunk);
        store.retire(chunk);
      }
      this.stores_.splice(i, 1);
    }
  }

  private releaseChunk(store: ChunkStore, chunk: Chunk) {
    this.queue_.cancel(chunk);

    if (chunk.texture !== undefined) {
      chunk.releasedAt ??= performance.now();
      return;
    }
    if (chunk.state === "loading") return;

    clearChunkData(chunk);
    store.retire(chunk);
  }

  private enqueueWithinBudget(candidates: WantedChunk[]) {
    if (candidates.length === 0) {
      this.oversizedWarned_ = false;
      return;
    }

    candidates.sort((a, b) => comparePriority(a.demand, b.demand));

    let committedBytes = this.getGpuResidentBytes_();
    const victims = this.evictionCandidates();
    let oversized = false;

    for (const { source, store, key, demand } of candidates) {
      const bytes =
        store.elementCount(key) * source.loader.getBytesPerElement();

      // A chunk that can never fit must not trigger eviction. It would drain
      // the entire cache and still be skipped.
      if (bytes > this.memoryLimitBytes_) {
        oversized = true;
        continue;
      }

      if (committedBytes + bytes > this.memoryLimitBytes_) {
        committedBytes = this.evictWorseChunks(
          committedBytes,
          bytes,
          demand,
          victims
        );
      }

      if (committedBytes + bytes > this.memoryLimitBytes_) continue;

      committedBytes += bytes;
      const chunk = store.getEntry(key) ?? store.admit(key, demand);
      chunk.state = "queued";
      this.queue_.enqueue(chunk, (signal) =>
        source.loader.loadChunkData(chunk, signal)
      );
    }

    if (oversized && !this.oversizedWarned_) {
      Logger.warn(
        "ChunkManager",
        "Some visible chunks exceed the memory limit and will not load"
      );
    }
    this.oversizedWarned_ = oversized;
  }

  private evictionCandidates(): {
    store: ChunkStore;
    chunk: Chunk;
    drawn: boolean;
  }[] {
    const victims: { store: ChunkStore; chunk: Chunk; drawn: boolean }[] = [];

    for (const { store } of this.stores_) {
      const drawn = new Set(
        store.views.flatMap((view) => view.getChunksToRender())
      );
      for (const chunk of store.residentChunks) {
        if (chunk.visible) continue;
        victims.push({ store, chunk, drawn: drawn.has(chunk) });
      }
    }

    return victims.sort((x, y) => {
      if (x.drawn !== y.drawn) return x.drawn ? 1 : -1;
      const byRankDescending = -comparePriority(x.chunk, y.chunk);
      if (byRankDescending !== 0) return byRankDescending;
      return (x.chunk.releasedAt ?? 0) - (y.chunk.releasedAt ?? 0);
    });
  }

  private evictWorseChunks(
    committedBytes: number,
    pendingBytes: number,
    candidate: ChunkViewState,
    victims: { store: ChunkStore; chunk: Chunk; drawn: boolean }[]
  ): number {
    while (
      committedBytes + pendingBytes > this.memoryLimitBytes_ &&
      victims.length > 0 &&
      comparePriority(victims[0].chunk, candidate) > 0 &&
      (!victims[0].drawn || candidate.visible)
    ) {
      const victim = victims.shift()!;
      if (victim.chunk.texture === undefined) continue;

      committedBytes -= textureStorageBytes(victim.chunk.texture);
      this.disposeChunkTexture(victim.chunk);
      victim.store.retire(victim.chunk);
    }

    return committedBytes;
  }

  private awaitingUpload(): Chunk[] {
    return this.stores_.flatMap(({ store }) =>
      [...store.entries.values()].filter(
        (chunk) => chunk.state === "loaded" && chunk.texture === undefined
      )
    );
  }

  private uploadLoadedChunks() {
    if (!this.uploadTexture_) return;

    const pending = this.awaitingUpload().sort(comparePriority);
    for (const chunk of pending.slice(0, this.maxGpuUploadsPerUpdate_)) {
      chunk.texture = Texture3D.createWithChunk(chunk);
      this.uploadTexture_(chunk.texture);
      clearChunkData(chunk);
    }
  }

  private disposeChunkTexture(chunk: Chunk) {
    const texture = chunk.texture;
    chunk.texture = undefined;
    if (texture !== undefined) this.disposeTexture_?.(texture);
  }
}
