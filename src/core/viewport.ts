import { Camera } from "../objects/cameras/camera";
import { Layer } from "./layer";
import { CameraControls } from "../objects/cameras/controls";
import { Box2 } from "../math/box2";
import { vec2, vec3 } from "gl-matrix";
import { generateID } from "../utilities/id_generator";
import { Logger } from "../utilities/logger";
import { EventContext, EventDispatcher } from "./event_dispatcher";
import { Ray } from "../math/ray";

/**
 * Initialization properties for constructing a viewport.
 */
export type ViewportProps = {
  /** Unique id. Defaults to the element id or a generated id. */
  id?: string;
  /** Host element. */
  domElement: HTMLElement;
  /** The camera the viewport renders with. */
  camera: Camera;
  /** Layers to render in order. */
  layers?: Layer[];
  /** Input controls driving the camera. */
  cameraControls?: CameraControls;
};

/**
 * A region of the canvas that renders a stack of layers through a camera.
 *
 * Every viewport draws into the shared canvas through the area of its host
 * element. The element must be unique across viewports.
 *
 * Viewports also route input. Pointer and wheel events on the host element
 * are enriched with clip and world coordinates and a picking ray, sent to
 * each layer in order and passed to the camera controls unless a layer stops
 * propagation.
 *
 * ```ts
 * const viewport = new Viewport({
 *   domElement: canvas,
 *   camera,
 *   layers: [imageLayer],
 * });
 * const idetik = new Idetik({ canvas, viewports: [viewport] });
 *
 * viewport.addLayer(labelLayer);
 * ```
 *
 * @group Core
 */
export class Viewport {
  /** The viewport's unique identifier. */
  public readonly id: string;
  /** The host element defining the viewport's area. */
  public readonly domElement: HTMLElement;
  /** The camera the viewport renders with. */
  public readonly camera: Camera;
  /** The pointer and wheel event dispatcher for the host element. */
  public readonly events: EventDispatcher;
  /** Input controls driving the camera. */
  public cameraControls?: CameraControls;

  private layers_: Layer[] = [];

  constructor(props: ViewportProps) {
    this.id = props.id || props.domElement.id || generateID("viewport");
    this.domElement = props.domElement;
    this.camera = props.camera;
    this.cameraControls = props.cameraControls;
    this.updateAspectRatio();
    this.events = new EventDispatcher(this.domElement);
    this.events.addEventListener((event: EventContext) => {
      if (
        event.event instanceof PointerEvent ||
        event.event instanceof WheelEvent
      ) {
        const { clientX, clientY } = event.event;
        const client = vec2.fromValues(clientX, clientY);
        event.clipPos = this.clientToClip(client, 0);
        event.worldPos = this.camera.clipToWorld(event.clipPos);

        const near = this.camera.clipToWorld(this.clientToClip(client, -1));
        const far = this.camera.clipToWorld(this.clientToClip(client, 1));
        event.worldRay = new Ray(near, vec3.subtract(vec3.create(), far, near));
      }
      for (const layer of this.layers_) {
        layer.onEvent(event);
        if (event.propagationStopped) return;
      }
      this.cameraControls?.onEvent(event);
    });

    for (const layer of props.layers ?? []) this.addLayer(layer);
  }

  /**
   * The layers rendered by this viewport in order. Layers with `occludes`
   * set draw before non-occluding layers regardless of stack order.
   */
  public get layers(): readonly Layer[] {
    return this.layers_;
  }

  /**
   * Adds a layer to the top of the stack. Throws if the viewport already
   * contains the layer.
   *
   * @param layer - The layer to add.
   */
  public addLayer(layer: Layer): void {
    if (this.layers_.includes(layer)) {
      throw new Error(`${layer.type} is already in viewport "${this.id}".`);
    }
    this.layers_.push(layer);
  }

  /**
   * Removes a previously added layer.
   *
   * @param layer - The layer to remove.
   */
  public removeLayer(layer: Layer): void {
    const index = this.layers_.indexOf(layer);
    if (index === -1) {
      throw new Error(`Layer to remove not found: ${layer}`);
    }
    this.layers_.splice(index, 1);
  }

  /** Removes all layers from the viewport. */
  public removeAllLayers(): void {
    this.layers_ = [];
  }

  /**
   * Syncs the camera's aspect ratio to the host element's size. Called
   * automatically when the host element resizes.
   */
  public updateSize(): void {
    this.updateAspectRatio();
  }

  /**
   * Computes the viewport's box relative to the given element in device
   * pixels, with `y` flipped to match WebGL's bottom-left origin.
   *
   * @param element - The element to compute the box against, typically the
   *   canvas.
   * @returns The viewport's box in the element's coordinate space.
   */
  public getBoxRelativeTo(element: HTMLElement): Box2 {
    const viewportRect = this.getBox().toRect();
    const canvasRect = element.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;

    // convert canvas rect to device pixels
    // viewport rect is already in device pixels
    const canvasX = canvasRect.left * devicePixelRatio;
    const canvasY = canvasRect.top * devicePixelRatio;
    const canvasHeight = canvasRect.height * devicePixelRatio;

    const relativeX = viewportRect.x - canvasX;
    const relativeY = viewportRect.y - canvasY;

    // Note: WebGL Y coordinate is flipped, so we adjust the Y position
    const x = Math.floor(relativeX);
    const y = Math.floor(canvasHeight - relativeY - viewportRect.height);
    const width = Math.floor(viewportRect.width);
    const height = Math.floor(viewportRect.height);

    return new Box2(
      vec2.fromValues(x, y),
      vec2.fromValues(x + width, y + height)
    );
  }

  /**
   * The viewport's size in device pixels. Measured relative to its own host
   * element, so `x` and `y` are always `0`.
   */
  public getBufferRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    return this.getBoxRelativeTo(this.domElement).toRect();
  }

  /**
   * Converts a client-space position to clip space. The `y` axis points
   * down, matching the renderer's mirrored projection.
   *
   * @param position - The client-space position to convert.
   * @param depth - The clip-space z value.
   */
  public clientToClip(position: vec2, depth: number = 0): vec3 {
    const [x, y] = position;
    const rect = this.domElement.getBoundingClientRect();
    return vec3.fromValues(
      (2 * (x - rect.x)) / rect.width - 1,
      (2 * (y - rect.y)) / rect.height - 1,
      depth
    );
  }

  /**
   * Converts a client-space position such as a pointer location to world
   * space.
   *
   * @param position - The client-space position to convert.
   * @param depth - The clip-space z value.
   */
  public clientToWorld(position: vec2, depth: number = 0): vec3 {
    const clipPos = this.clientToClip(position, depth);
    return this.camera.clipToWorld(clipPos);
  }

  private getBox(): Box2 {
    const viewportRect = this.domElement.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;

    const x = viewportRect.left * devicePixelRatio;
    const y = viewportRect.top * devicePixelRatio;
    const width = viewportRect.width * devicePixelRatio;
    const height = viewportRect.height * devicePixelRatio;

    return new Box2(
      vec2.fromValues(x, y),
      vec2.fromValues(x + width, y + height)
    );
  }

  private updateAspectRatio(): void {
    const { width, height } = this.getBox().toRect();
    if (width <= 0 || height <= 0) {
      Logger.debug(
        "Viewport",
        `Skipping aspect ratio update for viewport ${this.id}: invalid dimensions ${width}x${height}`
      );
      return;
    }
    const aspectRatio = width / height;
    this.camera.setAspectRatio(aspectRatio);
  }
}
