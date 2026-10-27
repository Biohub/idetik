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
  private readonly stores_ = new Map<ChunkSource, ChunkStore>();
  private readonly awaitingUpload_ = new Map<Chunk, ChunkSource>();
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
    return Array.from(this.stores_, ([source, store]) =>
      computeSourceChunkStats(source, store)
    );
  }

  public addView(
    source: ChunkSource,
    policy: ImageSourcePolicy,
    axes?: SliceAxes
  ): ChunkStoreView {
    let store = this.stores_.get(source);
    if (!store) {
      store = new ChunkStore(source.loader.getSourceDimensionMap());
      this.stores_.set(source, store);
    }
    return store.addView(policy, axes);
  }

  /**
   * Collects chunk changes from every store's views. Chunks no longer wanted
   * are released: requests are cancelled and loaded data is freed, while
   * resident textures are kept until evicted. Wanted chunks are queued in
   * priority order within the memory budget, evicting lower-priority resident
   * chunks to make room, and then requests start up to the concurrency limit.
   * Stores without views are disposed along with their textures.
   *
   * Chunk data is not uploaded to the GPU here; see {@link uploadLoadedChunks}.
   */
  public update() {
    const candidates: { source: ChunkSource; chunk: Chunk }[] = [];

    for (const [source, store] of this.stores_) {
      const updatedChunks = store.updateAndCollectChunkChanges();

      for (const chunk of updatedChunks) {
        if (chunk.priority === null) {
          this.releaseChunk(chunk);
        } else {
          chunk.releasedAt = undefined;
          if (chunk.state === "queued") {
            candidates.push({ source, chunk });
          }
        }
      }
    }

    this.enqueueWithinBudget(candidates);
    this.queue_.flush();

    for (const [source, store] of this.stores_) {
      if (!store.canDispose()) continue;

      for (const chunk of [...store.residentChunks]) {
        this.disposeChunkTexture(store, chunk);
        chunk.state = "unloaded";
      }
      this.stores_.delete(source);
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
    candidates: { source: ChunkSource; chunk: Chunk }[]
  ) {
    if (candidates.length === 0) return;

    candidates.sort((a, b) => comparePriority(a.chunk, b.chunk));

    let committedBytes = this.getGpuResidentBytes_();
    const victims = this.evictionCandidates();

    for (const { source, chunk } of candidates) {
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
        if (!signal.aborted) this.awaitingUpload_.set(chunk, source);
      });
    }
  }

  private evictionCandidates(): {
    store: ChunkStore;
    chunk: Chunk;
    drawn: boolean;
  }[] {
    const victims: { store: ChunkStore; chunk: Chunk; drawn: boolean }[] = [];

    for (const store of this.stores_.values()) {
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
   * Uploads chunks that have finished loading to the GPU in priority order.
   *
   * Uploads are limited to a per-frame max to maintain interactivity.
   *
   * @param limit - Max uploads for this call.
   */
  public uploadLoadedChunks(limit = this.maxGpuUploadsPerUpdate_) {
    if (!this.uploadTexture_ || this.awaitingUpload_.size === 0) return;

    const pending = [...this.awaitingUpload_].sort(([a], [b]) =>
      comparePriority(a, b)
    );
    const count = Math.min(pending.length, limit);

    for (let i = 0; i < count; i++) {
      const [chunk, source] = pending[i];
      this.awaitingUpload_.delete(chunk);
      const store = this.stores_.get(source);
      if (!store) {
        clearChunkData(chunk);
        continue;
      }
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
