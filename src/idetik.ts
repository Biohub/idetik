import { WebGLRenderer } from "./renderers/webgl_renderer";
import { Logger } from "./utilities/logger";
import { ChunkManager } from "./data/chunk_manager";
import { Renderer } from "./core/renderer";
import { Stats } from "./core/stats";
import { createStats, type Stats as StatsMeter } from "./utilities/stats";
import { Viewport } from "./core/viewport";
import { PixelSizeObserver } from "./utilities/pixel_size_observer";
import { type Deferred, settle } from "./utilities/deferred";
import type { Layer } from "./core/layer";

const DEFAULT_MEMORY_LIMIT_MB = 2048;

/**
 * An object updated once per animation frame after any drawing.
 *
 * Overlays drive HUD elements that live outside the canvas such as scale
 * bars, time indicators, or memory readouts.
 *
 * ```ts
 * const chunkReadout: Overlay = {
 *   update(idetik) {
 *     div.textContent = `${idetik.stats.memory.cpuChunkCount} chunks`;
 *   },
 * };
 *
 * idetik.addOverlay(chunkReadout);
 * ```
 */
export type Overlay = {
  /** Called every animation frame, including when drawing is skipped. */
  update: (idetik: Idetik) => void;
};

/**
 * Initialization properties for constructing an Idetik instance.
 */
export type IdetikProps = {
  /** The canvas element to render into. */
  canvas: HTMLCanvasElement;
  /** Viewports to render at startup. */
  viewports?: Viewport[];
  /** Overlays to run each frame. */
  overlays?: Overlay[];
  /** Shows an FPS meter. Defaults to `false`. */
  showStats?: boolean;
  /** Memory budget for chunk data. Defaults to `2048`. */
  memoryLimitMB?: number;
  /** Max in-flight chunk requests. Defaults to `8`. */
  maxConcurrentRequests?: number;
  /**
   * Max GPU texture uploads per frame while running. Before {@link
   * Idetik.start}, loading uploads without a limit. Defaults to `4`.
   */
  maxGpuUploadsPerUpdate?: number;
};

export type IdetikContext = {
  chunkManager: ChunkManager;
};

function validateViewport(
  viewport: Viewport,
  existingViewports: readonly Viewport[]
): void {
  for (const existing of existingViewports) {
    if (existing.id === viewport.id) {
      throw new Error(
        `Duplicate viewport ID "${viewport.id}". Each viewport must have a unique ID.`
      );
    }
    if (existing.domElement === viewport.domElement) {
      const elementDescription =
        viewport.domElement.tagName.toLowerCase() +
        (viewport.domElement.id
          ? `#${viewport.domElement.id}`
          : "[element has no id]");
      throw new Error(
        "Multiple viewports cannot share the same HTML element: " +
        `viewports "${existing.id}" and "${viewport.id}" both use ${elementDescription}`
      );
    }
  }

  const seenLayers = new Set(
    existingViewports.flatMap((existing) => existing.layers)
  );
  for (const layer of viewport.layers) {
    if (seenLayers.has(layer)) {
      throw new Error(
        `${layer.type} cannot be shared by multiple viewports simultaneously.`
      );
    }
  }
}

/**
 * The entry point of an Idetik application.
 *
 * An Idetik instance owns the renderer and the chunk manager and drives the
 * render loop for the viewports it is given. Each viewport pairs a camera
 * and its controls with a stack of layers and draws into a region of the
 * shared canvas. Layers in all viewports stream chunks through the same
 * manager under a single memory budget.
 *
 * ```ts
 * const source = await OmeZarrImageSource.fromHttp({ url });
 *
 * const layer = new ImageLayer({
 *   source,
 *   sliceCoords: { t: 0, z: 0, c: [0] },
 * });
 *
 * const camera = new OrthographicCamera({
 *   left: 0,
 *   right: 1024,
 *   top: 0,
 *   bottom: 1024,
 * });
 *
 * const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
 * const idetik = new Idetik({
 *   canvas,
 *   viewports: [new Viewport({
 *     domElement: canvas,
 *     camera,
 *     layers: [layer],
 *     cameraControls: new PanZoomControls(camera),
 *   })],
 * });
 *
 * idetik.start();
 * ```
 *
 * @see {@link Layer} for the data layers rendered within a viewport.
 *
 * @group Core
 */
export class Idetik {
  /** The canvas element the renderer draws into. */
  public readonly canvas: HTMLCanvasElement;
  /** The registered overlays that update once per frame in order. */
  public readonly overlays: Overlay[];
  /** Runtime, memory, queue, chunk, and rendered-object statistics. */
  public readonly stats: Stats;

  private readonly chunkManager_: ChunkManager;
  private readonly context_: IdetikContext;
  private readonly renderer_: Renderer;
  private readonly viewports_: Viewport[];
  private readonly attachments_ = new Map<Layer, Viewport>();
  private readonly stats_?: StatsMeter;
  private readonly sizeObserver_: PixelSizeObserver;

  private lastAnimationId_?: number;
  private lastTimestamp_: DOMHighResTimeStamp = 0;
  private renderInvalidated_ = true;
  private running_ = false;
  private readonly pendingSettles_ = new Set<Deferred>();
  private readonly pendingRenders_: Deferred[] = [];

  /**
   * Creates an Idetik runtime for the given canvas.
   *
   * @param params - Initialization properties.
   */
  constructor(params: IdetikProps) {
    this.canvas = params.canvas;

    this.renderer_ = new WebGLRenderer(this.canvas);
    const memoryLimitMB = params.memoryLimitMB ?? DEFAULT_MEMORY_LIMIT_MB;
    const memoryLimitBytes = memoryLimitMB * 1024 * 1024;
    this.chunkManager_ = new ChunkManager(
      (texture) => this.renderer_.uploadTexture(texture),
      (texture) => this.renderer_.disposeTexture(texture),
      () => this.renderer_.gpuTextureBytes,
      memoryLimitBytes,
      params.maxConcurrentRequests,
      params.maxGpuUploadsPerUpdate
    );
    this.context_ = {
      chunkManager: this.chunkManager_,
    };

    this.viewports_ = [];
    for (const viewport of params.viewports ?? []) {
      validateViewport(viewport, this.viewports_);
      this.viewports_.push(viewport);
    }

    this.overlays = [...(params.overlays ?? [])];

    this.stats = new Stats(this.renderer_, this.chunkManager_, this.viewports_);
    if (params.showStats) this.stats_ = createStats();

    const sizeDependents: HTMLElement[] = [this.canvas];
    for (const viewport of this.viewports_) {
      if (viewport.domElement !== this.canvas) {
        sizeDependents.push(viewport.domElement);
      }
    }

    this.sizeObserver_ = new PixelSizeObserver(sizeDependents, () => {
      this.invalidate();
      this.runFrameNow();
    });
  }

  /** The width of the rendering surface in pixels. */
  public get width() {
    return this.renderer_.width;
  }

  /** The height of the rendering surface in pixels. */
  public get height() {
    return this.renderer_.height;
  }

  /** The viewports in render order. */
  public get viewports(): readonly Viewport[] {
    return this.viewports_;
  }

  /** Whether the render loop is running. */
  public get running(): boolean {
    return this.running_;
  }

  /**
   * Finds a viewport by its id.
   *
   * @param id - The id given in the viewport's definition.
   * @returns The matching viewport or `undefined` if none matches.
   */
  public getViewport(id: string): Viewport | undefined {
    return this.viewports_.find((v) => v.id === id);
  }

  /**
   * Adds a viewport at runtime.
   *
   * @param viewport - The viewport to add.
   * @returns The added viewport.
   */
  public addViewport(viewport: Viewport): Viewport {
    validateViewport(viewport, this.viewports_);
    viewport.updateSize();
    this.viewports_.push(viewport);
    this.invalidate();

    if (this.running) {
      viewport.events.connect();
      if (viewport.domElement !== this.canvas) {
        this.sizeObserver_.observe(viewport.domElement);
      }
    }

    Logger.info("Idetik", `Added viewport "${viewport.id}"`);
    return viewport;
  }

  /**
   * Removes a previously added viewport.
   *
   * @param viewport - The viewport to remove.
   * @returns `true` if the viewport was found and removed.
   */
  public removeViewport(viewport: Viewport): boolean {
    const index = this.viewports_.indexOf(viewport);

    if (index === -1) {
      Logger.warn(
        "Idetik",
        `Viewport "${viewport.id}" not found, nothing to remove`
      );
      return false;
    }

    if (this.running) {
      viewport.events.disconnect();
      if (viewport.domElement !== this.canvas) {
        this.sizeObserver_.unobserve(viewport.domElement);
      }
    }

    this.viewports_.splice(index, 1);
    for (const [layer, owner] of this.attachments_) {
      if (owner === viewport) {
        layer.onDetached(this.context_);
        this.attachments_.delete(layer);
      }
    }
    this.invalidate();
    Logger.info("Idetik", `Removed viewport "${viewport.id}"`);
    return true;
  }

  /**
   * Registers an overlay that updates once per frame.
   *
   * @param overlay - The overlay to add.
   */
  public addOverlay(overlay: Overlay): void {
    this.overlays.push(overlay);
  }

  /**
   * Removes a previously added overlay.
   *
   * @param overlay - The overlay to remove.
   * @returns `true` if the overlay was found and removed.
   */
  public removeOverlay(overlay: Overlay): boolean {
    const index = this.overlays.indexOf(overlay);
    if (index === -1) {
      Logger.warn("Idetik", "Overlay not found, nothing to remove");
      return false;
    }

    this.overlays.splice(index, 1);
    return true;
  }

  /**
   * Sets the memory budget for chunk data at runtime.
   *
   * @param memoryLimitMB - The new budget in megabytes.
   */
  public setMemoryLimitMB(memoryLimitMB: number): void {
    this.chunkManager_.memoryLimitBytes = memoryLimitMB * 1024 * 1024;
  }

  /**
   * Requests a draw on the next animation frame even if no internal state
   * has changed. This is the only way the runtime draws before {@link start}
   * is called.
   *
   * The returned promise resolves right after the draw, before the browser
   * composites the frame, so the canvas can be read back immediately:
   *
   * ```ts
   * await idetik.whenSettled({ timeoutMs: 10_000 });
   * await idetik.requestRender();
   * const thumbnail = idetik.canvas.toDataURL();
   * ```
   *
   * @returns A promise resolved once the draw has happened. It rejects if
   *   {@link stop} is called first.
   */
  public requestRender(): Promise<void> {
    const drawn = new Promise<void>((resolve, reject) => {
      this.pendingRenders_.push({ resolve, reject });
    });
    this.scheduleFrame();
    return drawn;
  }

  /**
   * Waits until loading has come to rest: no chunk requests queued or in
   * flight, no loaded chunks awaiting GPU upload, and no camera controls
   * moving. Chunks that don't fit the memory budget are never requested, so
   * they don't hold it up, but failed requests are retried, so a chunk that
   * keeps failing does; pass a timeout to bound the wait.
   *
   * While running, the render loop has drawn every resident chunk once this
   * resolves. Before {@link start} is called, this runs the loop without
   * drawing until settled; follow it with {@link requestRender} to draw the
   * result.
   *
   * @param options - `timeoutMs` rejects the promise if loading hasn't
   *   settled in time. Loading continues regardless.
   * @returns A promise resolved once settled. It rejects if loading settles
   *   with visible chunks at a layer's current LOD still not resident (e.g.
   *   over the memory budget), on timeout, or if {@link stop} is called
   *   first.
   */
  public whenSettled(options?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = options?.timeoutMs;
    const settled = new Promise<void>((resolve, reject) => {
      const deferred: Deferred = { resolve, reject };
      if (timeoutMs !== undefined) {
        deferred.timeout = setTimeout(() => {
          this.pendingSettles_.delete(deferred);
          reject(new Error(`Loading did not settle within ${timeoutMs} ms`));
        }, timeoutMs);
      }
      this.pendingSettles_.add(deferred);
    });
    this.scheduleFrame();
    return settled;
  }

  /**
   * Starts the render loop and connects input handlers.
   *
   * @returns The instance, for chaining.
   */
  public start() {
    Logger.info("Idetik", "Idetik runtime starting");
    if (!this.running) {
      this.running_ = true;
      this.invalidate();
      this.stats.resetRates();

      for (const viewport of this.viewports_) {
        viewport.events.connect();
      }

      this.sizeObserver_.connect();
      this.scheduleFrame();
    } else {
      Logger.warn("Idetik", "Idetik runtime already started");
    }
    return this;
  }

  private detachRemovedLayers(): void {
    for (const [layer, viewport] of this.attachments_) {
      if (
        !this.viewports_.includes(viewport) ||
        !viewport.layers.includes(layer)
      ) {
        layer.onDetached(this.context_);
        this.attachments_.delete(layer);
      }
    }
  }

  private animate(timestamp: DOMHighResTimeStamp) {
    this.lastAnimationId_ = undefined;
    this.stats_?.begin();

    this.renderer_.updateSize();
    for (const viewport of this.viewports_) {
      viewport.updateSize();
    }
    this.updateControls(timestamp);
    this.detachRemovedLayers();
    this.chunkManager_.uploadLoadedChunks(this.running ? undefined : Infinity);
    for (const viewport of this.viewports_) {
      this.updateViewport(viewport);
    }
    if (this.renderRequested || (this.running && this.renderInvalidated_)) {
      this.draw();
    }

    this.chunkManager_.update();
    this.resolveIfSettled();
    for (const overlay of this.overlays) {
      overlay.update(this);
    }

    this.stats_?.end();
    this.scheduleFrame();
  }

  private updateControls(timestamp: DOMHighResTimeStamp): void {
    // cap dt to prevent large time-step jumps when resuming from background tabs
    const dt = Math.min(timestamp - this.lastTimestamp_, 100) / 1000;
    this.lastTimestamp_ = timestamp;
    for (const viewport of this.viewports_) {
      viewport.cameraControls?.onUpdate(dt);
    }
  }

  private get renderRequested(): boolean {
    return this.pendingRenders_.length > 0;
  }

  private scheduleFrame(): void {
    if (this.lastAnimationId_ !== undefined) return;
    if (
      !this.running &&
      this.pendingSettles_.size === 0 &&
      !this.renderRequested
    ) {
      return;
    }
    this.lastAnimationId_ = requestAnimationFrame((timestamp) =>
      this.animate(timestamp)
    );
  }

  private cancelFrame(): void {
    if (this.lastAnimationId_ === undefined) return;
    cancelAnimationFrame(this.lastAnimationId_);
    this.lastAnimationId_ = undefined;
  }

  // Runs a frame synchronously, e.g. so a resize is drawn before the browser
  // paints the resized canvas.
  private runFrameNow(): void {
    this.cancelFrame();
    this.animate(performance.now());
  }

  private invalidate(): void {
    this.renderInvalidated_ = true;
  }

  private resolveIfSettled(): void {
    if (this.pendingSettles_.size === 0) return;
    if (this.viewports_.some((v) => v.cameraControls?.isMoving)) return;

    const queue = this.stats.queue;
    if (queue.pending > 0 || queue.running > 0 || queue.awaitingUpload > 0) {
      return;
    }

    const incomplete = this.stats.chunks.viewports.filter(
      ({ current }) => current.resident < current.requested
    );

    const error =
      incomplete.length === 0
        ? undefined
        : new Error(
          "Loading settled with visible chunks missing in viewport(s) " +
          incomplete.map((v) => `"${v.viewportId}"`).join(", ")
        )
    this.settleAll(error);
  }

  private settleAll(error?: Error): void {
    const deferreds = [...this.pendingSettles_];
    this.pendingSettles_.clear();
    settle(deferreds, error);
  }

  private updateViewport(viewport: Viewport): void {
    for (const layer of viewport.layers) {
      if (layer.attached && this.attachments_.get(layer) !== viewport) {
        throw new Error(
          `${layer.type} is already attached to another viewport or Idetik runtime.`
        );
      }
    }

    for (const layer of viewport.layers) {
      if (!layer.attached) {
        layer.onAttached(this.context_);
        this.attachments_.set(layer, viewport);
      }
    }

    for (const layer of viewport.layers) {
      const contentChanged = layer.update(viewport);
      const invalidated = layer.renderStateChanged();
      if (contentChanged || invalidated) {
        this.invalidate();
      }
    }

    if (viewport.renderStateChanged(this.canvas)) {
      this.invalidate();
    }
  }

  private draw(): void {
    this.renderInvalidated_ = false;
    this.renderer_.beginFrame();
    for (const viewport of this.viewports_) {
      this.renderer_.render(viewport);
    }
    this.renderer_.endFrame();
    this.stats.recordDraw();
    settle(this.pendingRenders_.splice(0));
  }

  /**
   * Stops the render loop and disconnects input handlers. Pending
   * {@link whenSettled} and {@link requestRender} promises reject.
   */
  public stop() {
    Logger.info("Idetik", "Idetik runtime stopping");
    const pending = this.pendingSettles_.size > 0 || this.renderRequested;
    this.settleAll(new Error("Idetik runtime stopped before settling"));
    settle(
      this.pendingRenders_.splice(0),
      new Error("Idetik runtime stopped before drawing")
    );
    this.cancelFrame();

    if (this.running) {
      this.running_ = false;
      this.sizeObserver_.disconnect();
      for (const viewport of this.viewports_) {
        viewport.events.disconnect();
      }
      this.stats.resetRates();
    } else if (!pending) {
      Logger.warn("Idetik", "Idetik runtime not started");
    }
  }
}
