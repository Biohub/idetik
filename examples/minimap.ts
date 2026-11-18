import {
  Layer,
  OrthographicCamera,
  OrthographicCameraFrame,
  Viewport,
} from "idetik";

type MinimapProps = {
  /** The main view's camera, which the minimap tracks and pans. */
  camera: OrthographicCamera;
  /** The full extent of the data, which the minimap always shows. */
  extent: OrthographicCameraFrame;
  /** The minimap's own layer: a layer can't be shared between viewports. */
  layer: Layer;
  /** An empty element to draw the minimap in, styled by example.css. */
  element: HTMLElement;
};

/**
 * An overview inset showing where the main view is within the whole image.
 * It's a second viewport framed to the full extent, so it only loads the
 * coarsest tiles, and it hides while the main view already shows everything.
 * Click or drag in it to center the main view there.
 *
 * Add `viewport` to Idetik's viewports and the minimap itself to its
 * overlays so it updates every frame.
 */
export class Minimap {
  public readonly viewport: Viewport;
  /** Set to `false` to hide the minimap even when zoomed in. */
  public enabled = true;
  private readonly camera_: OrthographicCamera;
  private readonly extent_: OrthographicCameraFrame;
  private readonly element_: HTMLElement;
  private readonly view_: HTMLDivElement;

  constructor({ camera, extent, layer, element }: MinimapProps) {
    this.camera_ = camera;
    this.extent_ = extent;
    this.element_ = element;
    this.view_ = document.createElement("div");
    this.view_.id = "minimap-view";
    element.append(this.view_);
    element.style.aspectRatio = `${this.width} / ${this.height}`;

    this.viewport = new Viewport({
      domElement: element,
      camera: new OrthographicCamera(extent),
      layers: [layer],
    });

    element.addEventListener("pointerdown", (e) => {
      element.setPointerCapture(e.pointerId);
      this.panTo(e);
    });
    element.addEventListener("pointermove", (e) => this.panTo(e));
  }

  public update() {
    const { min, max } = this.camera_.getWorldViewRect();
    const left = (Math.min(min[0], max[0]) - this.extent_.left) / this.width;
    const top = (Math.min(min[1], max[1]) - this.extent_.top) / this.height;
    const w = Math.abs(max[0] - min[0]) / this.width;
    const h = Math.abs(max[1] - min[1]) / this.height;
    // Tolerance for float error in the initial fit-to-extent view.
    const eps = 1e-6;
    const showsEverything =
      left <= eps && top <= eps && left + w >= 1 - eps && top + h >= 1 - eps;
    this.element_.style.visibility =
      this.enabled && !showsEverything ? "" : "hidden";
    this.view_.style.left = `${100 * left}%`;
    this.view_.style.top = `${100 * top}%`;
    this.view_.style.width = `${100 * w}%`;
    this.view_.style.height = `${100 * h}%`;
  }

  private get width() {
    return this.extent_.right - this.extent_.left;
  }

  private get height() {
    return this.extent_.bottom - this.extent_.top;
  }

  private panTo(e: PointerEvent) {
    if (!(e.buttons & 1)) return;
    const target = this.viewport.clientToWorld([e.clientX, e.clientY]);
    const { min, max } = this.camera_.getWorldViewRect();
    this.camera_.pan([
      target[0] - (min[0] + max[0]) / 2,
      target[1] - (min[1] + max[1]) / 2,
      0,
    ]);
  }
}
