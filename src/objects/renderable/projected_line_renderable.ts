import { RenderableObject } from "../../core/renderable_object";
import { ProjectedLineGeometry } from "../../objects/geometry/projected_line_geometry";
import { Color, ColorLike } from "../../math/color";

/**
 * Initialization properties for constructing a projected line renderable.
 */
export type ProjectedLineRenderableProps = {
  /** The line path geometry to draw. */
  geometry: ProjectedLineGeometry;
  /** The line color. */
  color: ColorLike;
  /** Line width in pixels. */
  width: number;
};

/**
 * A polyline drawn with a constant screen-space width.
 *
 * The line is extruded in the vertex shader so its width stays fixed in
 * pixels at any zoom level. Custom layers can construct it directly for
 * paths and outlines.
 *
 * @group Renderables
 */
export class ProjectedLineRenderable extends RenderableObject {
  private color_: Color;
  private width_: number;

  /**
   * Creates a projected line renderable for the given path geometry.
   *
   * @param props - Initialization properties.
   */
  constructor({ geometry, color, width }: ProjectedLineRenderableProps) {
    super();
    this.geometry = geometry;
    this.color_ = Color.from(color);
    this.width_ = width;
    this.programName = "projectedLine";
    this.depthProgramName = "projectedLineDepth";
  }

  /** Identifies the renderable type as `ProjectedLineRenderable`. */
  public get type() {
    return "ProjectedLineRenderable";
  }

  /** The line color. Assignable from any {@link ColorLike} value. */
  public get color(): Color {
    return this.color_;
  }

  /** @param value - The new line color. */
  public set color(value: ColorLike) {
    this.color_ = Color.from(value);
  }

  /** The line width in pixels. */
  public get width() {
    return this.width_;
  }

  /** @param value - The new width in pixels. */
  public set width(value: number) {
    this.width_ = value;
  }

  /** Returns the color and width uniforms for the line shader. */
  public override getUniforms() {
    return {
      u_lineColor: this.color.rgb,
      u_lineWidth: this.width,
    };
  }
}
