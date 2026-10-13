import { CameraControls, ScrollZoomMode } from "./controls";
import { EventContext } from "../../core/event_dispatcher";
import { PerspectiveCamera } from "./perspective_camera";
import { Spherical } from "../../math/spherical";

import { glMatrix, vec3 } from "gl-matrix";
import { clamp } from "../../utilities/clamp";

const MOUSE_BUTTON_NONE = -1;
const MOUSE_BUTTON_LEFT = 0;
const MOUSE_BUTTON_MIDDLE = 1;

const ORBIT_SPEED = 0.009;
const PAN_SPEED = 0.001;
const ZOOM_SPEED = 0.0009;
const DEFAULT_DAMPING_FACTOR = 0.5;
const DAMPING_FPS = 60; // Base FPS to normalize damping

/**
 * Initialization properties for constructing orbit controls.
 */
export type OrbitControlsProps = {
  /** Distance from the target in world units. Defaults to `1`. */
  radius?: number;
  /** Initial azimuth angle in radians. Defaults to `0`. */
  yaw?: number;
  /** Initial elevation angle in radians. Defaults to `0`. */
  pitch?: number;
  /** The point the camera orbits. Defaults to the origin. */
  target?: vec3;
  /** Velocity decay rate between `0` and `1`. Defaults to `0.5`. */
  dampingFactor?: number;
  /** When the scroll wheel zooms. Defaults to `"always"`. */
  scrollZoom?: ScrollZoomMode;
};

/**
 * Camera controls for orbiting a perspective camera around a target.
 *
 * Dragging with the left mouse button orbits, dragging with `Shift` held
 * or with the middle button pans the target, and the scroll wheel zooms by
 * changing the orbit radius. Input adds velocity that damping decays over time.
 *
 * ```ts
 * const camera = new PerspectiveCamera({ near: 1.0 });
 *
 * const idetik = new Idetik({
 *   canvas,
 *   viewports: [new Viewport({
 *     domElement: canvas,
 *     camera,
 *     layers: [volumeLayer],
 *     cameraControls: new OrbitControls(camera, {
 *       radius: 100,
 *       target: [40, 40, 10],
 *     }),
 *   })],
 * });
 * ```
 *
 * @group Controls
 */
export class OrbitControls implements CameraControls {
  private readonly camera_: PerspectiveCamera;

  private readonly orbitVelocity_ = new Spherical(0, 0, 0);
  private readonly panVelocity_ = vec3.create();

  private readonly currPos_: Spherical;
  private readonly currCenter_ = vec3.create();

  private readonly dampingFactor_: number;
  private readonly scrollZoom_: ScrollZoomMode;

  private currMouseButton_ = MOUSE_BUTTON_NONE;

  /**
   * Creates orbit controls and moves the camera to the initial pose.
   *
   * @param camera - The perspective camera to control.
   * @param params - Initialization properties.
   */
  constructor(camera: PerspectiveCamera, params?: OrbitControlsProps) {
    this.camera_ = camera;

    this.currPos_ = new Spherical(
      params?.radius ?? 1,
      params?.yaw ?? 0,
      params?.pitch ?? 0
    );

    if (params?.target) {
      vec3.copy(this.currCenter_, params.target);
    }

    this.dampingFactor_ = clamp(
      params?.dampingFactor ?? DEFAULT_DAMPING_FACTOR,
      0,
      1
    );

    this.scrollZoom_ = params?.scrollZoom ?? "always";

    this.updateCamera();
  }

  /** The current distance from the target in world units. */
  public get radius(): number {
    return this.currPos_.radius;
  }

  /** The current azimuth angle in radians. */
  public get yaw(): number {
    return this.currPos_.phi;
  }

  /** The current elevation angle in radians. */
  public get pitch(): number {
    return this.currPos_.theta;
  }

  /** A copy of the point the camera orbits. */
  public get target(): vec3 {
    return vec3.clone(this.currCenter_);
  }

  /** Whether any orbit, pan, or zoom velocity remains. */
  public get isMoving(): boolean {
    return (
      this.orbitVelocity_.phi !== 0 ||
      this.orbitVelocity_.theta !== 0 ||
      this.orbitVelocity_.radius !== 0 ||
      this.panVelocity_[0] !== 0 ||
      this.panVelocity_[1] !== 0 ||
      this.panVelocity_[2] !== 0
    );
  }

  /**
   * Handles a pointer or wheel event. Called automatically by the owning
   * viewport unless a layer stops propagation.
   *
   * @param event - The event with clip and world coordinates attached.
   */
  public onEvent(event: EventContext): void {
    switch (event.type) {
      case "pointerdown":
        this.onPointerDown(event);
        break;
      case "pointermove":
        this.onPointerMove(event);
        break;
      case "wheel":
        this.onWheel(event);
        break;
      case "pointerup":
      case "pointercancel":
        this.onPointerEnd(event);
        break;
    }
  }

  /**
   * Applies pending velocities to the camera and decays them toward zero.
   * Called automatically by the render loop once per frame.
   *
   * @param dt - Time since the last frame in seconds.
   */
  public onUpdate(dt: number) {
    if (
      this.orbitVelocity_.phi === 0 &&
      this.orbitVelocity_.theta === 0 &&
      this.orbitVelocity_.radius === 0 &&
      vec3.equals(this.panVelocity_, vec3.fromValues(0, 0, 0))
    ) {
      return;
    }

    this.currPos_.phi += this.orbitVelocity_.phi;
    this.currPos_.theta += this.orbitVelocity_.theta;
    this.currPos_.radius += this.orbitVelocity_.radius * this.currPos_.radius;

    vec3.add(this.currCenter_, this.currCenter_, this.panVelocity_);

    // Prevent the camera from reaching the poles (±π/2), where
    // the view direction would flip and orbit controls would invert.
    // We clamp the elevation angle slightly before ±π/2 to maintain
    // stable rotation and avoid gimbal-like artifacts.
    const limit = Math.PI / 2 - glMatrix.EPSILON;
    this.currPos_.theta = clamp(this.currPos_.theta, -limit, limit);
    this.currPos_.radius = Math.max(0.01, this.currPos_.radius);

    this.updateCamera();

    const damping = Math.pow(1.0 - this.dampingFactor_, dt * DAMPING_FPS);
    this.orbitVelocity_.phi *= damping;
    this.orbitVelocity_.theta *= damping;
    this.orbitVelocity_.radius *= damping;
    vec3.scale(this.panVelocity_, this.panVelocity_, damping);

    this.cutoffLowVelocity();
  }

  private onPointerDown(event: EventContext) {
    const e = event.event as PointerEvent;
    this.currMouseButton_ = e.button;

    (e.target as Element)?.setPointerCapture?.(e.pointerId);
  }

  private onPointerMove(event: EventContext) {
    if (this.currMouseButton_ == MOUSE_BUTTON_NONE) return;

    const e = event.event as PointerEvent;
    const dx = e.movementX ?? 0;
    const dy = e.movementY ?? 0;

    const doOrbit = this.currMouseButton_ === MOUSE_BUTTON_LEFT && !e.shiftKey;
    const doPan =
      (this.currMouseButton_ === MOUSE_BUTTON_LEFT && e.shiftKey) ||
      this.currMouseButton_ === MOUSE_BUTTON_MIDDLE;

    if (doOrbit) this.orbit(dx, dy);
    if (doPan) this.pan(dx, dy);
  }

  private onWheel(event: EventContext) {
    const e = event.event as WheelEvent;

    if (this.scrollZoom_ === "never") return;
    if (this.scrollZoom_ === "modifier" && !(e.ctrlKey || e.metaKey)) return;

    e.preventDefault(); // prevent the page from scrolling

    const dy = e.deltaY ?? 0;
    this.zoom(dy);
  }

  private onPointerEnd(event: EventContext) {
    this.currMouseButton_ = MOUSE_BUTTON_NONE;

    const e = event.event as PointerEvent;
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
  }

  private orbit(dx: number, dy: number) {
    this.orbitVelocity_.phi -= dx * ORBIT_SPEED;
    this.orbitVelocity_.theta += dy * ORBIT_SPEED;
  }

  private pan(dx: number, dy: number) {
    const speed = this.currPos_.radius * PAN_SPEED;
    const delta = vec3.create();

    vec3.scaleAndAdd(delta, delta, this.camera_.right, dx);
    vec3.scaleAndAdd(delta, delta, this.camera_.up, dy);
    vec3.scale(delta, delta, speed);

    vec3.sub(this.panVelocity_, this.panVelocity_, delta);
  }

  private zoom(dy: number) {
    this.orbitVelocity_.radius += dy * ZOOM_SPEED;
  }

  private updateCamera() {
    const p = vec3.add(vec3.create(), this.currCenter_, this.currPos_.toVec3());
    this.camera_.transform.setTranslation(p);
    this.camera_.transform.targetTo(this.currCenter_);
  }

  private cutoffLowVelocity() {
    if (Math.abs(this.orbitVelocity_.phi) < glMatrix.EPSILON)
      this.orbitVelocity_.phi = 0;
    if (Math.abs(this.orbitVelocity_.theta) < glMatrix.EPSILON)
      this.orbitVelocity_.theta = 0;
    if (Math.abs(this.orbitVelocity_.radius) < glMatrix.EPSILON)
      this.orbitVelocity_.radius = 0;
    if (vec3.length(this.panVelocity_) < glMatrix.EPSILON)
      vec3.zero(this.panVelocity_);
  }
}
