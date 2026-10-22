import { Node } from "../core/node";
import { Geometry } from "../core/geometry";
import { WireframeGeometry } from "../core/wireframe_geometry";
import { Texture } from "../objects/textures/texture";
import { TrsTransform } from "../math/transforms";
import { Shader } from "../renderers/shaders";
import { Color } from "../math/color";
import { CullingMode } from "../renderers/webgl_state";

/**
 * Abstract base class representing a {@link Layer}-renderable object.
 *
 * Renderables pair a geometry with a shader program, textures, uniform
 * values, and a world transform. Subclasses assign a geometry, select one
 * of the built-in shader programs through {@link programName} or provide
 * a new one, bind textures with {@link setTexture}, and override {@link getUniforms} to
 * feed values to the shader.
 *
 * ```ts
 * class MyRenderable extends RenderableObject {
 *   constructor(texture: Texture) {
 *     super();
 *     this.geometry = new PlaneGeometry(512, 512, 1, 1);
 *     this.programName = "floatScalarImage";
 *
 *     this.setTexture(0, texture);
 *   }
 *
 *   public get type() {
 *     return "MyRenderable";
 *   }
 *
 *   public override getUniforms() {
 *     return { u_imageSampler: 0 };
 *   }
 * }
 * ```
 *
 * @group Renderables
 */
export abstract class RenderableObject extends Node {
  /**
   * Draws the geometry's wireframe on top of the normal pass. Layers use
   * this as a chunk debugging aid. Defaults to `false`.
   */
  public wireframeEnabled = false;

  /** The color of the wireframe overlay. Defaults to `Color.WHITE`. */
  public wireframeColor = Color.WHITE;

  /**
   * Whether the object is depth tested when drawn. Objects that opt out
   * are also left out of the depth prepass. Defaults to `true`.
   */
  public depthTest = true;
  private readonly textures_: Texture[] = [];
  private staleTextures_: Texture[] = [];
  private readonly transform_ = new TrsTransform();
  private geometry_ = new Geometry();
  private wireframeGeometry_: WireframeGeometry | null = null;
  private programName_: Shader | null = null;
  private depthProgramName_: Shader | null = null;
  private cullFaceMode_: CullingMode = "none";

  /**
   * Assigns a texture to the given texture unit. The renderer binds each
   * entry of {@link textures} to its matching unit before drawing.
   *
   * @param index - The texture unit to bind to.
   * @param texture - The texture to assign.
   */
  public setTexture(index: number, texture: Texture) {
    this.textures_[index] = texture;
  }

  /**
   * Removes all assigned textures.
   */
  protected clearTextures() {
    this.textures_.length = 0;
  }

  /**
   * Queues a replaced texture for GPU disposal. Subclasses call this when
   * swapping out a texture they own. The renderer drains the queue
   * through {@link popStaleTextures} before the next draw. Passing
   * `undefined` is a no-op.
   *
   * @param texture - The texture that is no longer in use.
   */
  protected markStaleTexture(texture: Texture | undefined) {
    if (texture !== undefined) {
      this.staleTextures_.push(texture);
    }
  }

  /**
   * Drains the queue of textures marked stale. Called automatically by
   * the renderer, which disposes the GPU resources of each returned
   * texture.
   *
   * @returns The textures queued since the last call.
   */
  public popStaleTextures() {
    const stale = this.staleTextures_;
    this.staleTextures_ = [];
    return stale;
  }

  /**
   * The geometry drawn for this object.
   */
  public get geometry() {
    return this.geometry_;
  }

  /**
   * A line-segment version of {@link geometry} used for the wireframe
   * overlay. Built lazily on first access and cached until the geometry
   * changes.
   */
  public get wireframeGeometry() {
    this.wireframeGeometry_ ??= new WireframeGeometry(this.geometry);
    return this.wireframeGeometry_;
  }

  /**
   * Releases GPU buffers for {@link geometry} and any cached
   * {@link wireframeGeometry}. Layers call this when discarding a
   * renderable. CPU geometry data remains available for reuse.
   *
   * @param dispose - The runtime callback that releases a geometry's GPU buffers.
   */
  public disposeGeometry(dispose: (geometry: Geometry) => void): void {
    dispose(this.geometry_);
    if (this.wireframeGeometry_) dispose(this.wireframeGeometry_);
  }

  /** The assigned textures indexed by texture unit. */
  public get textures() {
    return this.textures_;
  }

  /**
   * The object's world transform as translation, rotation, and scale.
   * Layers position, orient, and size renderables through it.
   */
  public get transform() {
    return this.transform_;
  }

  /** @param geometry - The geometry to draw. */
  public set geometry(geometry: Geometry) {
    this.geometry_ = geometry;
    this.wireframeGeometry_ = null;
  }

  /**
   * The name of a shader program that draws the object. The
   * renderer skips objects whose program name is `null`.
   */
  public get programName(): Shader | null {
    return this.programName_;
  }

  /**
   * The name of the shader program used in the depth prepass or `null`
   * to stay out of it. Objects without one never occlude other layers.
   */
  public get depthProgramName(): Shader | null {
    return this.depthProgramName_;
  }

  /**
   * The geometry's bounding box transformed to world space. The renderer
   * culls objects whose box falls outside the view frustum.
   */
  public get boundingBox() {
    const box = this.geometry_.boundingBox.clone();
    box.applyTransform(this.transform_.matrix);
    return box;
  }

  /**
   * @param programName - The shader program name.
   */
  protected set programName(programName: Shader) {
    this.programName_ = programName;
  }

  /**
   * Selects the shader program for the depth prepass. Subclasses set
   * this so the object writes depth and occludes content in other
   * layers.
   *
   * @param programName - The shader program name.
   */
  protected set depthProgramName(programName: Shader) {
    this.depthProgramName_ = programName;
  }

  /** Which triangle faces are culled when drawing. Defaults to `"none"`. */
  public get cullFaceMode() {
    return this.cullFaceMode_;
  }

  /** @param mode - The culling mode to apply. */
  public set cullFaceMode(mode: CullingMode) {
    this.cullFaceMode_ = mode;
  }

  /**
   * Returns the uniform values to upload before drawing. Override in
   * subclasses that need custom uniforms. Values are matched to shader
   * uniforms by name and take precedence over the owning layer's
   * uniforms.
   */
  public getUniforms(): Record<string, unknown> {
    return {};
  }
}
