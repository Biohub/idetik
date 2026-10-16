import { Chunk, ChunkSource } from "./chunk";
import { SliceAxes } from "../math/axes";
import { ChunkQueue, comparePriority } from "./chunk_queue";
import { chunkMemoryStats, clearChunkData } from "./chunk_memory";
import { ChunkStore } from "./chunk_store";
import { computeSourceChunkStats, SourceChunkStats } from "./chunk_stats";
import { ChunkStoreView } from "./chunk_store_view";
import { ImageSourcePolicy } from "../core/image_source_policy";
import { Texture, textureStorageBytes } from "../objects/textures/texture";
import { Texture3D } from "../objects/textures/texture_3d";

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

export class ChunkManager {
  private readonly stores_: { source: ChunkSource; store: ChunkStore }[] = [];
  private readonly awaitingUpload_ = new Map<Chunk, ChunkStore>();
  private readonly queue_: ChunkQueue;

  private readonly uploadTexture_?: (texture: Texture) => void;
  private readonly disposeTexture_?: (texture: Texture) => void;
  private readonly getGpuResidentBytes_: () => number;
  private memoryLimitBytes_: number;
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
      awaitingUpload: this.awaitingUpload_.size,
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

  /**
   * Gathers what the views asked for, queues requests within the memory
   * budget, and evicts. Call after the layers update.
   */
  public update() {
    const candidates: {
      source: ChunkSource;
      store: ChunkStore;
      chunk: Chunk;
    }[] = [];

    for (const { source, store } of this.stores_) {
      const updatedChunks = store.updateAndCollectChunkChanges();

      for (const chunk of updatedChunks) {
        if (chunk.priority === null) {
          this.releaseChunk(chunk);
        } else {
          chunk.releasedAt = undefined;
          if (chunk.state === "queued") {
            candidates.push({ source, store, chunk });
          }
        }
      }
    }

    this.enqueueWithinBudget(candidates);
    this.queue_.flush();

    for (let i = this.stores_.length - 1; i >= 0; i--) {
      const { store } = this.stores_[i];
      if (!store.canDispose()) continue;

      for (const chunk of [...store.residentChunks]) {
        this.disposeChunkTexture(store, chunk);
        chunk.state = "unloaded";
      }
      for (const [chunk, owner] of this.awaitingUpload_) {
        if (owner === store) this.releaseChunk(chunk);
      }
      this.stores_.splice(i, 1);
    }
  }

  private releaseChunk(chunk: Chunk) {
    this.queue_.cancel(chunk);

    if (chunk.texture !== undefined) {
      chunk.releasedAt ??= performance.now();
      return;
    }

    this.awaitingUpload_.delete(chunk);
    clearChunkData(chunk);
    if (chunk.state === "loaded") chunk.state = "unloaded";
  }

  private enqueueWithinBudget(
    candidates: { source: ChunkSource; store: ChunkStore; chunk: Chunk }[]
  ) {
    if (candidates.length === 0) return;

    candidates.sort((a, b) => comparePriority(a.chunk, b.chunk));

    let committedBytes = this.getGpuResidentBytes_();
    const victims = this.evictionCandidates();

    for (const { source, store, chunk } of candidates) {
      const bytes = this.chunkBytes(source, chunk);

      // A chunk that can never fit must not trigger eviction. It would drain
      // the entire cache and still be skipped.
      if (bytes > this.memoryLimitBytes_) continue;

      if (committedBytes + bytes > this.memoryLimitBytes_) {
        committedBytes = this.evictWorseChunks(
          committedBytes,
          bytes,
          chunk,
          victims
        );
      }

      if (committedBytes + bytes > this.memoryLimitBytes_) continue;

      committedBytes += bytes;
      this.queue_.enqueue(chunk, async (signal) => {
        await source.loader.loadChunkData(chunk, signal);
        if (!signal.aborted) this.awaitingUpload_.set(chunk, store);
      });
    }
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
    candidate: Chunk,
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
      this.disposeChunkTexture(victim.store, victim.chunk);
      victim.chunk.state = "unloaded";
      victim.chunk.releasedAt = undefined;
    }

    return committedBytes;
  }

  private chunkBytes(source: ChunkSource, chunk: Chunk): number {
    const bytesPerElement = source.loader.getBytesPerElement();
    return chunk.shape.x * chunk.shape.y * chunk.shape.z * bytesPerElement;
  }

  /**
   * Uploads chunks that have finished loading, highest priority first. Call
   * before the layers update so they draw the new textures in the same
   * frame.
   *
   * @param limit - Max uploads for this call. Defaults to
   *   `maxGpuUploadsPerUpdate`.
   */
  public uploadLoadedChunks(limit = this.maxGpuUploadsPerUpdate_) {
    if (!this.uploadTexture_ || this.awaitingUpload_.size === 0) return;

    const pending = [...this.awaitingUpload_].sort(([a], [b]) =>
      comparePriority(a, b)
    );
    const count = Math.min(pending.length, limit);

    for (let i = 0; i < count; i++) {
      const [chunk, store] = pending[i];
      this.awaitingUpload_.delete(chunk);
      const texture = Texture3D.createWithChunk(chunk);
      this.uploadTexture_(texture);
      store.setChunkTexture(chunk, texture);
      clearChunkData(chunk);
    }
  }

  private disposeChunkTexture(store: ChunkStore, chunk: Chunk) {
    const texture = store.clearChunkTexture(chunk);
    if (texture !== undefined) this.disposeTexture_?.(texture);
  }
}
