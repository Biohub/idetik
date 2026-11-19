import { Geometry } from "../../core/geometry";
import { RenderableObject } from "../../core/renderable_object";
import { Color, type ColorLike } from "../../math/color";
import type { vec3 } from "gl-matrix";

/**
 * Initialization properties for constructing a mesh renderable.
 */
export type MeshRenderableProps = {
  /** The mesh geometry with position and normal attributes. */
  geometry: Geometry;
  /** The mesh color. Alpha is ignored. Defaults to `Color.WHITE`. */
  color?: ColorLike;
  /** Ambient lighting contribution. Defaults to `0.25`. */
  ambientStrength?: number;
  /** Diffuse lighting contribution. Defaults to `0.75`. */
  diffuseStrength?: number;
};

type UniformValues = {
  u_color: vec3;
  u_ambientStrength: number;
  u_diffuseStrength: number;
};

/**
 * An opaque mesh shaded with ambient light and a fixed overhead light.
 *
 * Normals are transformed to world space for diffuse shading. The mesh
 * also writes depth so it can occlude other layers. {@link MeshLayer}
 * creates one instance after its source has loaded.
 *
 * Vertex and index arrays are kept by reference in a separate geometry
 * object, allowing each renderable to use its own GPU buffers without
 * copying the source's CPU data.
 *
 * @group Renderables
 */
export class MeshRenderable extends RenderableObject {
  /** The mesh color. Alpha is ignored. Defaults to `Color.WHITE`. */
  public color: Color;
  /** Ambient lighting contribution. Defaults to `0.25`. */
  public ambientStrength: number;
  /** Diffuse lighting contribution. Defaults to `0.75`. */
  public diffuseStrength: number;

  /**
   * Creates a mesh renderable for the given geometry and appearance settings.
   *
   * @param props - Initialization properties.
   */
  constructor({
    geometry,
    color = Color.WHITE,
    ambientStrength = 0.25,
    diffuseStrength = 0.75,
  }: MeshRenderableProps) {
    super();
    this.color = Color.from(color);
    this.ambientStrength = ambientStrength;
    this.diffuseStrength = diffuseStrength;

    this.geometry = new Geometry(
      geometry.vertexData,
      geometry.indexData,
      geometry.primitive
    );

    geometry.attributes.forEach((attribute) => {
      this.geometry.addAttribute({ ...attribute });
    });

    this.programName = "mesh";
    this.depthProgramName = "meshDepth";
  }

  /** Identifies the renderable type as `MeshRenderable`. */
  public get type() {
    return "MeshRenderable";
  }

  /** Returns the color and lighting strength uniforms for the mesh shader. */
  public override getUniforms(): UniformValues {
    return {
      u_color: this.color.rgb,
      u_ambientStrength: this.ambientStrength,
      u_diffuseStrength: this.diffuseStrength,
    };
  }
}
