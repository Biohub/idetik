import { WebGLRenderer } from "./renderers/webgl_renderer";
import { Logger } from "./utilities/logger";
import { ChunkManager } from "./data/chunk_manager";
import { Renderer } from "./core/renderer";
import { Stats } from "./core/stats";
import { createStats, type Stats as StatsMeter } from "./utilities/stats";
import { Viewport } from "./core/viewport";
import { PixelSizeObserver } from "./utilities/pixel_size_observer";
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
  /** Max GPU texture uploads per frame. Defaults to `4`. */
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
  /** Memory, queue, chunk, and rendered-object statistics. */
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
  private renderRequested_ = false;
  private renderInvalidated_ = true;

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
      this.renderer_.updateSize();
      this.detachRemovedLayers();

      for (const viewport of this.viewports_) {
        viewport.updateSize();
        this.updateViewport(viewport);
      }

      this.draw();
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
    return this.lastAnimationId_ !== undefined;
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
   * Explicitly requests a draw on the next animation frame while running,
   * even if no internal state has changed.
   */
  public requestRender(): void {
    this.renderRequested_ = true;
  }

  /**
   * Starts the render loop and connects input handlers.
   *
   * @returns The instance, for chaining.
   */
  public start() {
    Logger.info("Idetik", "Idetik runtime starting");
    if (!this.running) {
      this.invalidate();

      for (const viewport of this.viewports_) {
        viewport.events.connect();
      }

      this.sizeObserver_.connect();

      this.lastAnimationId_ = requestAnimationFrame((timestamp) => {
        this.lastTimestamp_ = timestamp;
        this.animate(timestamp);
      });
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
    this.stats_?.begin();

    // cap dt to prevent large time-step jumps when resuming from background tabs
    const dt = Math.min(timestamp - this.lastTimestamp_, 100) / 1000;

    this.lastTimestamp_ = timestamp;
    this.detachRemovedLayers();

    for (const viewport of this.viewports_) {
      viewport.cameraControls?.onUpdate(dt);
    }

    for (const viewport of this.viewports_) {
      this.updateViewport(viewport);
    }

    if (this.renderRequested_ || this.renderInvalidated_) {
      this.draw();
    }

    this.chunkManager_.update();

    for (const overlay of this.overlays) {
      overlay.update(this);
    }

    this.stats_?.end();
    this.lastAnimationId_ = requestAnimationFrame((timestamp) =>
      this.animate(timestamp)
    );
  }

  private invalidate(): void {
    this.renderInvalidated_ = true;
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
    this.renderRequested_ = false;
    this.renderInvalidated_ = false;
    this.renderer_.beginFrame();
    for (const viewport of this.viewports_) {
      this.renderer_.render(viewport);
    }
  }

  /**
   * Stops the render loop and disconnects input handlers.
   */
  public stop() {
    Logger.info("Idetik", "Idetik runtime stopping");
    if (!this.running) {
      Logger.warn("Idetik", "Idetik runtime not started");
    } else {
      this.sizeObserver_.disconnect();
      for (const viewport of this.viewports_) {
        viewport.events.disconnect();
      }
      // safe non-null assertion: this.running is true, so lastAnimationId_ is defined
      cancelAnimationFrame(this.lastAnimationId_!);
      this.lastAnimationId_ = undefined;
    }
  }
}
