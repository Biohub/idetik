import { vec3 } from "gl-matrix";
import { OrthographicCamera } from "./orthographic_camera";
import { EventContext } from "../../core/event_dispatcher";

const LEFT_MOUSE_BUTTON = 0;

/**
 * The contract between a viewport and its camera controls.
 *
 * Implement this interface to drive a camera with custom input logic and
 * assign it to a viewport through its `cameraControls` property. The
 * viewport passes pointer and wheel events to `onEvent` unless a layer
 * stops propagation.
 *
 * ```ts
 * class ClickToZoomControls implements CameraControls {
 *   constructor(private camera: OrthographicCamera) {}
 *
 *   get isMoving() {
 *     return false;
 *   }
 *
 *   onUpdate(dt: number) {}
 *
 *   onEvent(event: EventContext) {
 *     if (event.type === "pointerdown") this.camera.zoom(2);
 *   }
 * }
 *
 * viewport.cameraControls = new ClickToZoomControls(camera);
 * ```
 *
 * @group Controls
 */
export interface CameraControls {
  /**
   * Whether the camera is in motion from user interaction. Layers may
   * read this to reduce rendering quality while the view changes.
   */
  readonly isMoving: boolean;

  /**
   * Advances time-based motion such as damping. Called automatically by
   * the render loop.
   *
   * @param dt - Time since the last frame in seconds.
   */
  onUpdate(dt: number): void;

  /**
   * Handles a pointer or wheel event. Called automatically by the owning
   * viewport unless a layer stops propagation.
   *
   * @param event - The event with clip and world coordinates attached.
   */
  onEvent(event: EventContext): void;
}

export type ScrollZoomMode = "always" | "modifier" | "never";

/**
 * Initialization properties for constructing pan and zoom controls.
 */
export type PanZoomControlsProps = {
  /** When the scroll wheel zooms. Defaults to `"always"`. */
  scrollZoom?: ScrollZoomMode;
};

/**
 * Camera controls for 2D pan and zoom with an orthographic camera.
 *
 * Dragging with the left mouse button pans the view and the scroll wheel
 * zooms around the cursor, keeping the point under the pointer fixed.
 * Movement applies immediately with no inertia or damping.
 *
 * ```ts
 * const camera = new OrthographicCamera({
 *   left: 0,
 *   right: 1024,
 *   top: 0,
 *   bottom: 1024,
 * });
 *
 * const idetik = new Idetik({
 *   canvas,
 *   viewports: [new Viewport({
 *     domElement: canvas,
 *     camera,
 *     layers: [imageLayer],
 *     cameraControls: new PanZoomControls(camera),
 *   })],
 * });
 * ```
 *
 * @group Controls
 */
export class PanZoomControls implements CameraControls {
  private readonly camera_: OrthographicCamera;
  private readonly scrollZoom_: ScrollZoomMode;
  private dragActive_ = false;
  private dragStart_: vec3 = vec3.create();

  /**
   * Creates pan and zoom controls for the given camera.
   *
   * @param camera - The orthographic camera to control.
   * @param params - Initialization properties.
   */
  constructor(camera: OrthographicCamera, params?: PanZoomControlsProps) {
    this.camera_ = camera;
    this.scrollZoom_ = params?.scrollZoom ?? "always";
  }

  /** Whether a pan drag is in progress. */
  public get isMoving(): boolean {
    return this.dragActive_;
  }

  /**
   * Handles a pointer or wheel event. Called automatically by the owning
   * viewport unless a layer stops propagation.
   *
   * @param event - The event with clip and world coordinates attached.
   */
  public onEvent(event: EventContext): void {
    switch (event.type) {
      case "wheel":
        this.onWheel(event);
        break;
      case "pointerdown":
        this.onPointerDown(event);
        break;
      case "pointermove":
        this.onPointerMove(event);
        break;
      case "pointerup":
      case "pointercancel":
        this.onPointerEnd(event);
        break;
    }
  }

  /**
   * Does nothing. Pan and zoom apply immediately with no inertia.
   *
   * @param _delta - Time since the last frame in seconds. Unused.
   */
  public onUpdate(_delta: number) {}

  private onWheel(event: EventContext) {
    if (!event.worldPos || !event.clipPos) return;
    const e = event.event as WheelEvent;

    if (this.scrollZoom_ === "never") return;
    if (this.scrollZoom_ === "modifier" && !(e.ctrlKey || e.metaKey)) return;

    // Prevent the page from scrolling, the default action for wheel events.
    e.preventDefault();

    const posBeforeZoom = vec3.clone(event.worldPos);
    const zoomFactor = e.deltaY < 0 ? 1.05 : 0.95;

    this.camera_.zoom(zoomFactor);

    const posAfterZoom = this.camera_.clipToWorld(event.clipPos);
    const delta = vec3.sub(vec3.create(), posBeforeZoom, posAfterZoom);
    this.camera_.pan(delta);
  }

  private onPointerDown(event: EventContext) {
    const e = event.event as PointerEvent;
    if (!event.worldPos || e.button !== LEFT_MOUSE_BUTTON) return;

    this.dragStart_ = vec3.clone(event.worldPos);
    this.dragActive_ = true;

    (e.target as Element)?.setPointerCapture?.(e.pointerId);
  }

  private onPointerMove(event: EventContext) {
    if (!this.dragActive_ || !event.worldPos) return;

    const delta = vec3.sub(vec3.create(), this.dragStart_, event.worldPos);
    this.camera_.pan(delta);
  }

  private onPointerEnd(event: EventContext) {
    const e = event.event as PointerEvent;
    if (!this.dragActive_ || e.button !== LEFT_MOUSE_BUTTON) return;

    this.dragActive_ = false;

    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
  }
}
