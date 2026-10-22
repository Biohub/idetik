import { mat4, vec3 } from "gl-matrix";

import { Layer } from "../core/layer";
import { Viewport } from "../core/viewport";
import { GaussianSplatSource } from "../data/gaussian_splat_source";
import { GaussianSplatRenderable } from "../objects/renderable/gaussian_splat_renderable";

// Re-sort when the view direction has rotated more than one degree.
const RESORT_COS_ANGLE = Math.cos((1 * Math.PI) / 180);

/**
 * Initialization properties for a Gaussian splat layer.
 */
export type GaussianSplatLayerProps = {
  /** The splats to render. */
  source: GaussianSplatSource;
  /** Layer opacity in `[0, 1]`. Defaults to `1`. */
  opacity?: number;
  /**
   * Compensates opacity for the screen-space dilation, as expected by scenes
   * trained with anti-aliasing. Defaults to the source's `antialiased`.
   */
  antialias?: boolean;
};

/**
 * A layer that renders 3D Gaussian splats.
 *
 * Each splat is drawn as a screen-space ellipse from its projected
 * covariance and composited back to front with premultiplied alpha. Splats
 * are depth sorted whenever the view direction rotates by more than a degree.
 *
 * ```ts
 * const source = await GaussianSplatSource.fromPly(url);
 * viewport.addLayer(new GaussianSplatLayer({ source }));
 * ```
 *
 * @group Layers
 */
export class GaussianSplatLayer extends Layer {
  /** Identifies the layer type as `GaussianSplatLayer`. */
  public readonly type = "GaussianSplatLayer";

  /**
   * Whether opacity is compensated for the screen-space dilation that keeps
   * sub-pixel splats from aliasing. Scenes trained with anti-aliasing expect
   * it; scenes trained like the original 3D Gaussian Splatting would render
   * too faint with it.
   */
  public antialias: boolean;

  private readonly renderable_: GaussianSplatRenderable;
  private readonly modelView_ = mat4.create();
  private readonly direction_ = vec3.create();
  // Zero until the first sort, so the first update always sorts.
  private readonly sortedDirection_ = vec3.create();

  /**
   * Creates a layer that renders splats from a source.
   *
   * @param props - Initialization properties.
   */
  constructor({
    source,
    opacity = 1,
    antialias = source.antialiased,
  }: GaussianSplatLayerProps) {
    super({ opacity, blendMode: "premultipliedOver", occludes: false });
    this.antialias = antialias;
    this.renderable_ = new GaussianSplatRenderable(source.splats);
    this.addObject(this.renderable_);
    this.setState("ready");
  }

  public update(viewport?: Viewport) {
    if (!viewport) return;
    const modelView = mat4.multiply(
      this.modelView_,
      viewport.camera.viewMatrix,
      this.renderable_.transform.matrix
    );
    // Depth order depends only on the view direction, and changes slowly with
    // it, so small rotations reuse the previous order.
    const direction = vec3.set(
      this.direction_,
      modelView[2],
      modelView[6],
      modelView[10]
    );
    vec3.normalize(direction, direction);
    if (vec3.dot(direction, this.sortedDirection_) > RESORT_COS_ANGLE) return;
    vec3.copy(this.sortedDirection_, direction);
    this.renderable_.sortBackToFront(modelView);
  }

  public override getUniforms() {
    return { u_antialias: Number(this.antialias) };
  }
}
