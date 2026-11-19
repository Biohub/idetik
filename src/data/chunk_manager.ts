import { Chunk, ChunkKey, ChunkSource } from "./chunk";
import { SliceAxes } from "../math/axes";
import { ChunkQueue, comparePriority } from "./chunk_queue";
import { chunkMemoryStats, clearChunkData, setChunkData } from "./chunk_memory";
import { ChunkStore } from "./chunk_store";
import { computeSourceChunkStats, SourceChunkStats } from "./chunk_stats";
import { ChunkStoreView } from "./chunk_store_view";
import { ImageSourcePolicy } from "../core/image_source_policy";
import {
  bufferToDataType,
  isTextureUnpackRowAlignment,
  Texture,
  textureStorageBytes,
} from "../objects/textures/texture";
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
};

const DEFAULT_MAX_CONCURRENT_REQUESTS = 8;
const DEFAULT_MAX_GPU_UPLOADS_PER_UPDATE = 4;

// New data for a resident chunk. The copy goes through the queue in place of
// the chunk, so the chunk keeps its state and draws its old texture until the
// new data is uploaded into it.
type Reload = {
  copy: Chunk;
  // The source changed the chunk again after this load started.
  stale: boolean;
};

type SourceEntry = {
  source: ChunkSource;
  store: ChunkStore;
  unsubscribe?: () => void;
  // Chunks the source reported changed since the last update.
  changed: Set<Chunk> | "all";
  reloads: Map<Chunk, Reload>;
};

export class ChunkManager {
  private readonly stores_: SourceEntry[] = [];
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
    let entry = this.stores_.find((s) => s.source === source);
    if (!entry) {
      entry = this.createEntry(source);
      this.stores_.push(entry);
    }
    return entry.store.addView(policy, axes);
  }

  public update() {
    const candidates: { source: ChunkSource; chunk: Chunk }[] = [];

    for (const entry of this.stores_) {
      const { source, store } = entry;
      const updatedChunks = store.updateAndCollectChunkChanges();
      this.applyChanges(entry);

      for (const chunk of updatedChunks) {
        if (chunk.priority === null) {
          this.releaseChunk(entry, chunk);
        } else {
          chunk.releasedAt = undefined;
          if (chunk.state === "queued") {
            candidates.push({ source, chunk });
          }
        }
      }

      this.uploadLoadedChunks(entry, updatedChunks);
    }

    this.enqueueWithinBudget(candidates);
    this.queue_.flush();

    for (let i = this.stores_.length - 1; i >= 0; i--) {
      const entry = this.stores_[i];
      if (!entry.store.canDispose()) continue;

      entry.unsubscribe?.();
      for (const chunk of [...entry.reloads.keys()]) {
        this.cancelReload(entry, chunk);
      }
      for (const chunk of [...entry.store.residentChunks]) {
        this.dropResidentChunk(entry, chunk);
      }
      this.stores_.splice(i, 1);
    }
  }

  private createEntry(source: ChunkSource): SourceEntry {
    const entry: SourceEntry = {
      source,
      store: new ChunkStore(source.loader.getSourceDimensionMap()),
      changed: new Set(),
      reloads: new Map(),
    };
    entry.unsubscribe = source.onChunksChanged?.((keys) =>
      this.recordChanges(entry, keys)
    );
    return entry;
  }

  // Called by the source at any time, so it only records what changed.
  // update() applies the changes.
  private recordChanges(entry: SourceEntry, keys?: readonly ChunkKey[]) {
    if (keys === undefined) {
      entry.changed = "all";
      return;
    }
    if (entry.changed === "all") return;

    for (const key of keys) {
      const chunk = entry.store.getChunk(key);
      if (chunk === undefined) {
        Logger.warn(
          "ChunkManager",
          `Ignoring change to a chunk outside the source: ${JSON.stringify(key)}`
        );
        continue;
      }
      entry.changed.add(chunk);
    }
  }

  // Runs after the store aggregates view states, so `priority` says whether
  // a changed chunk is still needed this frame.
  private applyChanges(entry: SourceEntry) {
    const { changed, store } = entry;
    if (changed !== "all" && changed.size === 0) return;
    entry.changed = new Set();

    const chunks = changed === "all" ? this.chunksInUse(store) : changed;
    for (const chunk of chunks) {
      this.applyChange(entry, chunk);
    }
  }

  private chunksInUse(store: ChunkStore): Set<Chunk> {
    const chunks = new Set(store.residentChunks);
    for (const view of store.views) {
      for (const chunk of view.chunkViewStates.keys()) chunks.add(chunk);
    }
    return chunks;
  }

  private applyChange(entry: SourceEntry, chunk: Chunk) {
    if (chunk.texture !== undefined) {
      if (chunk.priority === null) {
        this.dropResidentChunk(entry, chunk);
      } else {
        this.reload(entry, chunk);
      }
      return;
    }

    switch (chunk.state) {
      case "loading":
        // The aborted load stores nothing and leaves the chunk unloaded, so
        // the views queue it again.
        this.queue_.cancel(chunk);
        break;
      case "loaded":
        clearChunkData(chunk);
        chunk.state = "unloaded";
        break;
    }
  }

  private reload(entry: SourceEntry, chunk: Chunk) {
    const reload = entry.reloads.get(chunk);
    if (reload === undefined) {
      this.enqueueReload(entry, chunk);
    } else if (reload.copy.state !== "queued") {
      // A reload that has not started will read the new data anyway.
      reload.stale = true;
    }
  }

  // Reloads do not count against the memory budget: the chunk's texture is
  // already resident and the new data replaces its contents.
  private enqueueReload(entry: SourceEntry, chunk: Chunk) {
    const copy: Chunk = {
      ...chunk,
      data: undefined,
      texture: undefined,
      state: "queued",
    };
    entry.reloads.set(chunk, { copy, stale: false });
    const { source } = entry;
    this.queue_.enqueue(copy, (signal) => this.loadChunk(source, copy, signal));
  }

  private cancelReload(entry: SourceEntry, chunk: Chunk): boolean {
    const reload = entry.reloads.get(chunk);
    if (reload === undefined) return false;

    this.queue_.cancel(reload.copy);
    clearChunkData(reload.copy);
    entry.reloads.delete(chunk);
    return true;
  }

  private async loadChunk(
    source: ChunkSource,
    chunk: Chunk,
    signal: AbortSignal
  ): Promise<void> {
    const data = await source.loader.loadChunkData(chunk, signal);
    // A loader may resolve after its request was cancelled. Rejecting marks
    // the chunk unloaded and drops the data, which may be stale.
    signal.throwIfAborted();

    const rowAlignment = data.BYTES_PER_ELEMENT;
    if (!isTextureUnpackRowAlignment(rowAlignment)) {
      throw new Error(
        "Invalid row alignment value. Possible values are 1, 2, 4, or 8"
      );
    }
    chunk.rowAlignmentBytes = rowAlignment;
    setChunkData(chunk, data);
  }

  private releaseChunk(entry: SourceEntry, chunk: Chunk) {
    this.queue_.cancel(chunk);

    if (this.cancelReload(entry, chunk)) {
      // The texture holds data the source has replaced, so it is not worth
      // keeping for when the chunk is needed again.
      this.dropResidentChunk(entry, chunk);
      return;
    }

    if (chunk.texture !== undefined) {
      chunk.releasedAt ??= performance.now();
      return;
    }

    clearChunkData(chunk);
    if (chunk.state === "loaded") chunk.state = "unloaded";
  }

  private dropResidentChunk(entry: SourceEntry, chunk: Chunk) {
    this.cancelReload(entry, chunk);
    this.disposeChunkTexture(entry.store, chunk);
    chunk.state = "unloaded";
    chunk.releasedAt = undefined;
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
      this.queue_.enqueue(chunk, (signal) =>
        this.loadChunk(source, chunk, signal)
      );
    }
  }

  private evictionCandidates(): {
    entry: SourceEntry;
    chunk: Chunk;
    drawn: boolean;
  }[] {
    const victims: { entry: SourceEntry; chunk: Chunk; drawn: boolean }[] = [];

    for (const entry of this.stores_) {
      const { store } = entry;
      const drawn = new Set(
        store.views.flatMap((view) => view.getChunksToRender())
      );
      for (const chunk of store.residentChunks) {
        if (chunk.visible) continue;
        victims.push({ entry, chunk, drawn: drawn.has(chunk) });
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
    victims: { entry: SourceEntry; chunk: Chunk; drawn: boolean }[]
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
      this.dropResidentChunk(victim.entry, victim.chunk);
    }

    return committedBytes;
  }

  private chunkBytes(source: ChunkSource, chunk: Chunk): number {
    const bytesPerElement = source.loader.getBytesPerElement();
    return chunk.shape.x * chunk.shape.y * chunk.shape.z * bytesPerElement;
  }

  // First uploads and finished reloads share the per-update upload limit.
  private uploadLoadedChunks(entry: SourceEntry, chunks: Set<Chunk>) {
    const pending: Chunk[] = [];

    if (this.uploadTexture_) {
      for (const chunk of chunks) {
        if (chunk.state === "loaded" && chunk.texture === undefined) {
          pending.push(chunk);
        }
      }
    }

    for (const [chunk, reload] of entry.reloads) {
      switch (reload.copy.state) {
        case "loaded":
          pending.push(chunk);
          break;
        case "unloaded":
          // The load failed; try again, as first loads do.
          this.enqueueReload(entry, chunk);
          break;
        default:
          reload.copy.priority = chunk.priority;
          reload.copy.orderKey = chunk.orderKey;
      }
    }

    if (pending.length === 0) return;

    pending.sort(comparePriority);

    const limit = Math.min(pending.length, this.maxGpuUploadsPerUpdate_);

    for (let i = 0; i < limit; i++) {
      const chunk = pending[i];
      const reload = entry.reloads.get(chunk);
      if (reload !== undefined) {
        this.applyReload(entry, chunk, reload);
        continue;
      }

      const texture = Texture3D.createWithChunk(chunk);
      this.uploadTexture_?.(texture);
      entry.store.setChunkTexture(chunk, texture);
      clearChunkData(chunk);
    }
  }

  private applyReload(entry: SourceEntry, chunk: Chunk, reload: Reload) {
    entry.reloads.delete(chunk);
    const { copy } = reload;
    const data = copy.data;
    clearChunkData(copy);

    const texture = chunk.texture;
    if (data === undefined || texture === undefined) return;

    chunk.rowAlignmentBytes = copy.rowAlignmentBytes;
    if (bufferToDataType(data) === texture.dataType) {
      texture.unpackAlignment = copy.rowAlignmentBytes;
      texture.data = data;
      if (this.uploadTexture_) {
        this.uploadTexture_(texture);
        texture.releaseCpuData();
      }
    } else {
      // Texture storage has a fixed format, so data of another type needs a
      // new texture. The chunk is uploaded again like a first load.
      this.disposeChunkTexture(entry.store, chunk);
      setChunkData(chunk, data);
    }

    if (reload.stale) this.applyChange(entry, chunk);
  }

  private disposeChunkTexture(store: ChunkStore, chunk: Chunk) {
    const texture = store.clearChunkTexture(chunk);
    if (texture !== undefined) this.disposeTexture_?.(texture);
  }
}
