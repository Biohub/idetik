import type { ChunkManager, QueueStats } from "../data/chunk_manager";
import {
  computeViewportChunkStats,
  type ChunkStats,
  type ViewportChunkStats,
} from "../data/chunk_stats";
import { ImageLayer } from "../layers/image_layer";
import { LabelLayer } from "../layers/label_layer";
import { VolumeLayer } from "../layers/volume_layer";
import type { Renderer } from "./renderer";
import type { Viewport } from "./viewport";

/** A snapshot of memory used by chunks, renderer textures, and the JS heap. */
export type MemoryStats = {
  /** Bytes of chunk data in CPU memory, shared across all Idetik instances. */
  cpuChunkBytes: number;
  /** Number of chunks in CPU memory, shared across all Idetik instances. */
  cpuChunkCount: number;
  /** Bytes of texture data resident on this instance's GPU renderer. */
  gpuTextureBytes: number;
  /** Number of textures resident on this instance's GPU renderer. */
  gpuTextureCount: number;
  /** Used JS heap in bytes, when the browser exposes it. Not instance-specific. */
  jsHeapUsedBytes?: number;
  /** JS heap size limit in bytes, when the browser exposes it. */
  jsHeapLimitBytes?: number;
};

/**
 * A snapshot of drawing frequency and GPU draw cost.
 *
 * Values are averaged over sampling windows of at least one second. A frame
 * is one canvas draw pass across all viewports including draws during resize.
 * GPU timings are collected asynchronously and lag draw submission.
 */
export type RuntimeStats = {
  /** Whether GPU timer queries are supported by the current renderer context. */
  gpuTimingSupported: boolean;
  /**
   * Canvas draw passes per second in the latest sampling window.
   * This value diverges from frames per second when on-demand rendering
   * is enabled.
   */
  renderedFramesPerSecond: number;
  /**
   * Mean elapsed GPU timeline time per sampled canvas render pass, in ms.
   * The interval spans drawing across all viewports, excluding layer updates.
   * Undefined when no recent valid sample exists.
   */
  gpuMsPerFrame?: number;
};

/**
 * Statistics available through `idetik.stats`.
 *
 * Getters read the current state. Only `chunks` walks chunk states. Reading
 * runtime rates, memory usage, queue counts, or rendered objects does not
 * scan chunks.
 *
 * @group Core
 */
export class Stats {
  private readonly renderer_: Renderer;
  private readonly chunkManager_: ChunkManager;
  private readonly viewports_: readonly Viewport[];
  private readonly runtime_: RuntimeStats = {
    gpuTimingSupported: false,
    renderedFramesPerSecond: 0,
  };

  private sampleStartedAt_ = performance.now();
  private draws_ = 0;
  private gpuSamples_ = 0;
  private gpuMsAtWindowStart_ = 0;

  /** @hidden */
  constructor(
    renderer: Renderer,
    chunkManager: ChunkManager,
    viewports: readonly Viewport[]
  ) {
    this.renderer_ = renderer;
    this.chunkManager_ = chunkManager;
    this.viewports_ = viewports;
  }

  /**
   * Drawing frequency and GPU cost, recalculated on read when at least one
   * second has passed since the last calculation or reset. Values cover that
   * entire interval, so less frequent reads produce longer-term averages.
   */
  public get runtime(): RuntimeStats {
    this.sample();
    const gpu = this.renderer_.gpuTiming;
    const recentGpuSample =
      gpu.supported &&
      gpu.lastSampleAt !== undefined &&
      performance.now() - gpu.lastSampleAt < 3000;
    return {
      ...this.runtime_,
      gpuTimingSupported: gpu.supported,
      gpuMsPerFrame: recentGpuSample ? this.runtime_.gpuMsPerFrame : undefined,
    };
  }

  /**
   * CPU chunk memory shared across instances, this renderer's GPU texture
   * memory, and optional JS heap figures. Heap figures are not specific to
   * this instance. Sizes are in bytes.
   */
  public get memory(): MemoryStats {
    const perf = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      }
    ).memory;

    return {
      ...this.chunkManager_.memoryStats,
      gpuTextureBytes: this.renderer_.gpuTextureBytes,
      gpuTextureCount: this.renderer_.gpuTextureCount,
      jsHeapUsedBytes: perf?.usedJSHeapSize,
      jsHeapLimitBytes: perf?.jsHeapSizeLimit,
    };
  }

  /** Counts of queued and in-flight chunk requests for this instance. */
  public get queue(): QueueStats {
    return this.chunkManager_.queueStats;
  }

  /**
   * Chunk demand and GPU residency per source, by timepoint, and loading
   * progress per viewport. Each read walks every view's chunk states, so poll
   * it at the rate you need rather than every frame.
   */
  public get chunks(): ChunkStats {
    const viewports: ViewportChunkStats[] = [];
    for (const viewport of this.viewports_) {
      const views = [];
      for (const layer of viewport.layers) {
        // TODO: replace with a generic hook once non-image chunked layers
        // (e.g. meshes, point clouds) exist
        if (
          !(layer instanceof ImageLayer) &&
          !(layer instanceof LabelLayer) &&
          !(layer instanceof VolumeLayer)
        ) {
          continue;
        }
        if (layer.chunkStoreView) views.push(layer.chunkStoreView);
      }
      if (views.length === 0) continue;
      viewports.push(computeViewportChunkStats(viewport.id, views));
    }
    return { sources: this.chunkManager_.sourceChunkStats, viewports };
  }

  /** Objects reported by the renderer for the last viewport render. */
  public get renderedObjects(): number {
    return this.renderer_.renderedObjects;
  }

  /** @hidden */
  public recordDraw(): void {
    this.draws_ += 1;
  }

  /** @hidden */
  private sample(): void {
    const now = performance.now();
    const elapsedSeconds = (now - this.sampleStartedAt_) / 1000;
    if (elapsedSeconds < 1) return;

    this.runtime_.renderedFramesPerSecond = this.draws_ / elapsedSeconds;

    const gpu = this.renderer_.gpuTiming;
    const gpuSamples = gpu.samples - this.gpuSamples_;
    if (gpu.supported && gpu.lastSampleAt !== undefined && gpuSamples > 0) {
      this.runtime_.gpuMsPerFrame =
        (gpu.totalMs - this.gpuMsAtWindowStart_) / gpuSamples;
    } else {
      this.runtime_.gpuMsPerFrame = undefined;
    }

    this.resetSample(now);
  }

  /** @hidden */
  public resetRates(): void {
    this.renderer_.resetGpuTiming();
    this.runtime_.renderedFramesPerSecond = 0;
    this.runtime_.gpuMsPerFrame = undefined;
    this.resetSample(performance.now());
  }

  private resetSample(now: number): void {
    const gpu = this.renderer_.gpuTiming;
    this.sampleStartedAt_ = now;
    this.draws_ = 0;
    this.gpuSamples_ = gpu.samples;
    this.gpuMsAtWindowStart_ = gpu.totalMs;
  }
}
