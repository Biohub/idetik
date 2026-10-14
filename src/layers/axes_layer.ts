import { Layer } from "../core/layer";
import { ProjectedLineGeometry } from "../objects/geometry/projected_line_geometry";
import { ProjectedLineRenderable } from "../objects/renderable/projected_line_renderable";

/**
 * Initialization properties for constructing an axes layer.
 */
export type AxesLayerProps = {
  /** Axis length in world units. */
  length: number;
  /** Line width in pixels. */
  width: number;
};

/**
 * A layer that draws the world coordinate axes as colored lines.
 *
 * Three lines start at the world origin: `x` in red, `y` in green, and
 * `z` in blue, each with the given length and width. The layer is static
 * and ready as soon as it is constructed.
 *
 * ```ts
 * viewport.addLayer(new AxesLayer({ length: 100, width: 2 }));
 * ```
 *
 * @group Layers
 */
export class AxesLayer extends Layer {
  /** Identifies the layer type as `AxesLayer`. */
  public readonly type = "AxesLayer";

  /**
   * Creates an axes layer with the given dimensions.
   *
   * @param props - Initialization properties.
   */
  constructor(props: AxesLayerProps) {
    super();
    const { length, width } = props;
    this.addObject(
      makeAxis({
        end: [length, 0, 0],
        width: width,
        color: [1, 0, 0],
      })
    );
    this.addObject(
      makeAxis({
        end: [0, length, 0],
        width: width,
        color: [0, 1, 0],
      })
    );
    this.addObject(
      makeAxis({
        end: [0, 0, length],
        width: width,
        color: [0, 0, 1],
      })
    );
    this.setState("ready");
  }

  /** Performs no per-frame work. The axes are built at construction. */
  public update(): boolean {
    return true;
  }
}

function makeAxis(params: {
  end: [number, number, number];
  width: number;
  color: [number, number, number];
}) {
  const { end, width, color } = params;
  const geometry = new ProjectedLineGeometry([[0, 0, 0], end]);
  return new ProjectedLineRenderable({
    geometry: geometry,
    color: color,
    width: width,
  });
}
