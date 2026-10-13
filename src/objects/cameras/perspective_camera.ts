import { Camera, CameraType } from "./camera";
import { glMatrix, mat4, vec3 } from "gl-matrix";

const DEFAULT_FOV = 60; // degrees
const DEFAULT_ASPECT_RATIO = 1.77; // 16:9
const MIN_FOV = 0.1; // degrees
const MAX_FOV = 180 - MIN_FOV; // degrees

/**
 * Initialization properties for constructing a perspective camera.
 */
export type PerspectiveCameraProps = {
  /** Vertical field of view in degrees. Defaults to `60`. */
  fov?: number;
  /** Aspect ratio (width / height). Defaults to `1.77`. */
  aspectRatio?: number;
  /** Near clipping plane distance. Defaults to `0.1`. */
  near?: number;
  /** Far clipping plane distance. Defaults to `10000`. */
  far?: number;
  /** World-space camera position. Defaults to the origin. */
  position?: vec3;
};

/**
 * A camera using a perspective projection.
 *
 * Perspective projection applies foreshortening: objects appear smaller the
 * farther they are from the camera, which makes this the camera to use for
 * 3D scenes such as volume rendering. It pairs naturally with
 * {@link OrbitControls}.
 *
 * The projection is defined by a vertical field of view, an aspect ratio,
 * and near/far clipping planes. Zooming narrows or widens the field of view
 * rather than moving the camera.
 *
 * ```ts
 * const camera = new PerspectiveCamera({ fov: 45 });
 *
 * const controls = new OrbitControls(camera, {
 *   radius: 1200,
 *   target: [0, 0, 0],
 * });
 *
 * const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
 * const idetik = new Idetik({
 *   canvas,
 *   viewports: [new Viewport({
 *     domElement: canvas,
 *     camera,
 *     layers: [volumeLayer],
 *     cameraControls: controls
 *   })],
 * });
 * ```
 *
 * @see {@link OrthographicCamera} for 2D image viewing with parallel
 *   projection.
 *
 * @group Cameras
 */
export class PerspectiveCamera extends Camera {
  private fov_: number;
  private aspectRatio_: number;

  /**
   * Creates a perspective camera from the given projection settings.
   *
   * @param props - Initialization properties.
   */
  constructor(props: PerspectiveCameraProps = {}) {
    const {
      fov = DEFAULT_FOV,
      aspectRatio = DEFAULT_ASPECT_RATIO,
      near = 0.1,
      far = 10000,
      position = vec3.fromValues(0, 0, 0),
    } = props;

    if (fov < MIN_FOV || fov > MAX_FOV) {
      throw new Error(
        `Invalid field of view: ${fov}, must be in [${MIN_FOV}, ${MAX_FOV}] degrees`
      );
    }
    super();
    this.fov_ = fov;
    this.aspectRatio_ = aspectRatio;
    this.near_ = near;
    this.far_ = far;

    this.transform.setTranslation(position);

    this.updateProjectionMatrix();
  }

  /**
   * Sets the aspect ratio (width / height) of the viewport the camera
   * renders into. Called automatically by the owning viewport when it
   * resizes.
   *
   * @param aspectRatio - The viewport's width divided by its height.
   */
  public setAspectRatio(aspectRatio: number) {
    this.aspectRatio_ = aspectRatio;
    this.updateProjectionMatrix();
  }

  /** Identifies the camera type as `PerspectiveCamera`. */
  public get type(): CameraType {
    return "PerspectiveCamera";
  }

  /** The vertical field of view in degrees. */
  public get fov() {
    return this.fov_;
  }

  /**
   * Zooms the view by the given factor relative to the current zoom level.
   * Factors greater than `1` zoom in and factors between `0` and `1` zoom
   * out.
   *
   * Zooming narrows or widens the field of view rather than moving the
   * camera, and the result is clamped to valid angles.
   *
   * @param factor - The magnification factor to apply.
   */
  public zoom(factor: number) {
    if (factor <= 0) {
      throw new Error(`Invalid zoom factor: ${factor}`);
    }
    // clamp the field of view to prevent degenerate behavior
    this.fov_ = Math.max(MIN_FOV, Math.min(MAX_FOV, this.fov_ / factor));
    this.updateProjectionMatrix();
  }

  /** @hidden */
  protected updateProjectionMatrix() {
    mat4.perspective(
      this.projectionMatrix_,
      glMatrix.toRadian(this.fov),
      this.aspectRatio_,
      this.near_,
      this.far_
    );
  }
}
