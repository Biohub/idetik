import { Camera, CameraType } from "./camera";
import { quat, vec2, vec3, vec4, mat4 } from "gl-matrix";
import { Box2 } from "../../math/box2";
import {
  AxisComponent,
  SliceAxes,
  SliceOrientation,
  orientationRotation,
  sliceAxesFor,
} from "../../math/axes";

const DEFAULT_ASPECT_RATIO = 1.77; // 16:9
const DEFAULT_WIDTH = 128;
const DEFAULT_HEIGHT = 128 / DEFAULT_ASPECT_RATIO;
const DEFAULT_NEAR = -1e6;
const DEFAULT_FAR = 1e6;

/**
 * A world-space rectangle for the camera to frame.
 */
export type OrthographicCameraFrame = {
  /** Left edge of the view frame in world units. */
  left: number;
  /** Right edge of the view frame in world units. */
  right: number;
  /** Top edge of the view frame in world units. */
  top: number;
  /** Bottom edge of the view frame in world units. */
  bottom: number;
};

/**
 * Initialization properties for constructing an orthographic camera.
 */
export type OrthographicCameraProps = {
  /** Left edge of the view frame in world units. */
  left: number;
  /** Right edge of the view frame in world units. */
  right: number;
  /** Top edge of the view frame in world units. */
  top: number;
  /** Bottom edge of the view frame in world units. */
  bottom: number;
  /** Near clipping plane distance. Defaults to `-1e6`. */
  near?: number;
  /** Far clipping plane distance. Defaults to `1e6`. */
  far?: number;
  /** Slice orientation. Defaults to `"XY"`. */
  orientation?: SliceOrientation;
};

/**
 * A camera using an orthographic (parallel) projection.
 *
 * Orthographic projection has no perspective foreshortening: objects render at
 * the same size regardless of their distance from the camera, which makes this
 * the camera to use for 2D image viewing. It pairs naturally with
 * {@link PanZoomControls}.
 *
 * The constructor frames a world-space rectangle, typically the physical
 * extent of the image being viewed. Zoom and pan are then applied as scale and
 * translation on top of that frame, and {@link setFrame} resets them. When the
 * viewport's aspect ratio differs from the frame's, the frame is padded rather
 * than stretched, so image pixels always stay square.
 *
 * ```ts
 * const camera = new OrthographicCamera({
 *  left: 0,
 *  right: 1024,
 *  top: 0,
 *  bottom: 1024
 * });
 *
 * const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
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
 * @group Cameras
 */
export class OrthographicCamera extends Camera {
  // width_ and height_ should always be defined by constructor (see setFrame)
  private width_: number = DEFAULT_WIDTH;
  private height_: number = DEFAULT_HEIGHT;
  private viewportAspectRatio_: number = DEFAULT_ASPECT_RATIO;
  private viewportSize_: [number, number] = [DEFAULT_WIDTH, DEFAULT_HEIGHT];
  private axes_: SliceAxes;
  private rotation_: quat;
  private orientation_: SliceOrientation;

  /**
   * Creates an orthographic camera framing the given world-space rectangle.
   *
   * @param props - Initialization properties.
   */
  constructor(props: OrthographicCameraProps) {
    super();
    this.near_ = props.near ?? DEFAULT_NEAR;
    this.far_ = props.far ?? DEFAULT_FAR;
    this.orientation_ = props.orientation ?? "XY";
    this.axes_ = sliceAxesFor(this.orientation_);
    this.rotation_ = orientationRotation(this.axes_);
    this.setFrame(props);
    this.updateProjectionMatrix();
  }

  /**
   * The world-space size of the rendered view as `[width, height]`.
   *
   * This is the camera frame padded to match the viewport's aspect ratio, so
   * it reflects what is actually visible rather than the frame that was set.
   */
  public get viewportSize() {
    return this.viewportSize_;
  }

  /**
   * Sets the aspect ratio (width / height) of the viewport the camera renders
   * into. Called automatically by the owning viewport when it resizes.
   *
   * @param aspectRatio - The viewport's width divided by its height.
   */
  public setAspectRatio(aspectRatio: number) {
    this.viewportAspectRatio_ = aspectRatio;
    this.updateProjectionMatrix();
  }

  /**
   * Reframes the camera to the given world-space rectangle, resetting any
   * accumulated zoom and pan.
   *
   * The frame may be padded horizontally or vertically at render time to
   * match the viewport's aspect ratio (see {@link viewportSize}).
   *
   * @param frame - The view frame edges in world units.
   */
  public setFrame({ left, right, top, bottom }: OrthographicCameraFrame) {
    this.width_ = Math.abs(right - left);
    this.height_ = Math.abs(top - bottom);
    this.updateProjectionMatrix();
    const translation = vec3.create();
    translation[AxisComponent[this.axes_.u]] = 0.5 * (left + right);
    translation[AxisComponent[this.axes_.v]] = 0.5 * (bottom + top);
    this.transform.setTranslation(translation);
    this.transform.setScale([1, 1, 1]);
    this.transform.setRotation(this.rotation_);
  }

  /** Identifies the camera type as `OrthographicCamera`. */
  public get type(): CameraType {
    return "OrthographicCamera";
  }

  /** The slice orientation the camera faces. */
  public get orientation(): SliceOrientation {
    return this.orientation_;
  }

  /**
   * Changes the slice orientation the camera faces. The current frame and
   * zoom carry over numerically to the new plane axes. Call {@link setFrame}
   * to reframe the view for the new plane.
   *
   * @param orientation - The slice plane for the camera to face.
   */
  public setOrientation(orientation: SliceOrientation) {
    if (orientation === this.orientation_) {
      return;
    }

    const u = this.transform.translation[AxisComponent[this.axes_.u]];
    const v = this.transform.translation[AxisComponent[this.axes_.v]];

    this.orientation_ = orientation;
    this.axes_ = sliceAxesFor(orientation);
    this.rotation_ = orientationRotation(this.axes_);

    const translation = vec3.create();
    translation[AxisComponent[this.axes_.u]] = u;
    translation[AxisComponent[this.axes_.v]] = v;

    this.transform.setTranslation(translation);
    this.transform.setRotation(this.rotation_);
  }

  /**
   * Zooms the view by the given factor relative to the current zoom level.
   * Factors greater than `1` zoom in and factors between `0` and `1` zoom
   * out.
   *
   * @param factor - The magnification factor to apply.
   */
  public zoom(factor: number) {
    if (factor <= 0) {
      throw new Error(`Invalid zoom factor: ${factor}`);
    }
    const inverseFactor = 1.0 / factor;
    this.transform.addScale([inverseFactor, inverseFactor, 1.0]);
  }

  /**
   * Computes the world-space rectangle currently visible in the viewport,
   * accounting for zoom, pan, and aspect-ratio padding.
   *
   * @returns The visible rectangle on the camera's slice plane.
   */
  public getWorldViewRect(): Box2 {
    let topLeft = vec4.fromValues(-1.0, -1.0, 0.0, 1.0);
    let bottomRight = vec4.fromValues(1.0, 1.0, 0.0, 1.0);

    const inv = mat4.invert(mat4.create(), this.getViewProjection())!;
    topLeft = vec4.transformMat4(vec4.create(), topLeft, inv);
    bottomRight = vec4.transformMat4(vec4.create(), bottomRight, inv);

    const u = AxisComponent[this.axes_.u];
    const v = AxisComponent[this.axes_.v];
    return new Box2(
      vec2.fromValues(topLeft[u], topLeft[v]),
      vec2.fromValues(bottomRight[u], bottomRight[v])
    );
  }

  /** @hidden */
  protected updateProjectionMatrix() {
    // The following code ensures that the orthographic projection matrix
    // is updated so that the aspect ratio of renderable objects is respected
    // (e.g. image pixels are isotropic) by padding the camera frame to form
    // the viewport frame.
    const width = this.width_;
    const height = this.height_;
    const frameAspectRatio = width / height;
    // When the viewport is wider than the camera frame, add horizontal
    // padding such that the height is unchanged. Otherwise, add vertical
    // padding such that the width is unchanged.
    let viewportHalfWidth = 0.5 * width;
    let viewportHalfHeight = 0.5 * height;
    if (this.viewportAspectRatio_ > frameAspectRatio) {
      viewportHalfWidth *= this.viewportAspectRatio_ / frameAspectRatio;
    } else {
      viewportHalfHeight *= frameAspectRatio / this.viewportAspectRatio_;
    }
    this.viewportSize_ = [2 * viewportHalfWidth, 2 * viewportHalfHeight];
    // Center the camera frame in the padded viewport frame.
    mat4.ortho(
      this.projectionMatrix_,
      -viewportHalfWidth,
      viewportHalfWidth,
      -viewportHalfHeight,
      viewportHalfHeight,
      this.near_,
      this.far_
    );
  }
}
