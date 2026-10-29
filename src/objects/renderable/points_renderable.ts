import { vec3 } from "gl-matrix";

import { Color, ColorLike } from "../../math/color";
import { RenderableObject } from "../../core/renderable_object";
import { Texture2DArray } from "../textures/texture_2d_array";
import { Geometry } from "../../core/geometry";

type Marker = "circle" | "square" | "triangle";

const MARKER_INDEX: Record<Marker, number> = {
  circle: 0,
  square: 1,
  triangle: 2,
};

// TODO: add a border (or "secondary") color to improve contrast against background
/**
 * Initialization properties for a point in {@link PointsRenderable}.
 */
export type PointProps = {
  /** World-space position of the point. */
  position: vec3;
  /** Fill color of the marker. */
  color: ColorLike;
  /** Marker size, in the renderable's {@link PointsRenderableOptions.sizeUnits}. */
  size: number;
  /** Marker shape. */
  marker: Marker;
};

/**
 * Options for constructing a {@link PointsRenderable}.
 */
export type PointsRenderableOptions = {
  /**
   * Units of each point's `size`. `"pixels"` (the default) keeps markers a
   * fixed size on screen; `"world"` makes `size` a world-space diameter, so
   * markers grow and shrink with zoom (and with distance in perspective).
   * World sizes ignore any scale in the renderable's transform.
   */
  sizeUnits?: "pixels" | "world";
  /** Multiplier applied to every point's size. Defaults to `1`. */
  sizeScale?: number;
  /** Smallest on-screen marker diameter in pixels. Defaults to `0`. */
  minPixelSize?: number;
  /**
   * Largest on-screen marker diameter in pixels. Defaults to no limit,
   * though the GPU caps point sizes (`ALIASED_POINT_SIZE_RANGE`, at least
   * 1 px and often 64–1024 px).
   */
  maxPixelSize?: number;
};

/**
 * A depth range for {@link PointsRenderable.depthSlab}, in the renderable's
 * model-space z (before its transform).
 */
export type PointDepthSlab = {
  /** Middle of the slab. */
  center: number;
  /** Full thickness; points farther than half of it from `center` are not
   *  drawn. `Infinity` keeps every point (useful with `flatten`). */
  thickness: number;
  /**
   * Draw the kept points at z = `center` instead of their own z, e.g. to
   * overlay a slab of a 3D point cloud on a 2D image plane. Defaults to
   * `false`.
   */
  flatten?: boolean;
};

/**
 * A set of point markers drawn as screen-space sprites.
 *
 * Each point has a world-space position, a color, a size, and a marker
 * shape. Sizes are in screen pixels unless {@link sizeUnits} is `"world"`.
 * All instances share a single marker sprite atlas. The
 * point set is fixed at construction, so build a new instance to change
 * it. Construct these directly inside a custom {@link Layer}.
 *
 * ```ts
 * class Particles extends Layer {
 *   public readonly type = "Particles";
 *
 *   constructor(positions: vec3[]) {
 *     super();
 *     this.addObject(
 *       new PointsRenderable(
 *         positions.map((position) => ({
 *           position,
 *           color: Color.RED,
 *           size: 20,
 *           marker: "circle" as const,
 *         }))
 *       )
 *     );
 *     this.setState("ready");
 *   }
 *
 *   public update(): boolean {
 *     return true;
 *   }
 * }
 * ```
 *
 * @group Renderables
 */
export class PointsRenderable extends RenderableObject {
  /** Units of each point's size. Can be changed without rebuilding. */
  public sizeUnits: "pixels" | "world";
  /** Multiplier applied to every point's size. Can be changed without rebuilding. */
  public sizeScale: number;
  /** Smallest on-screen marker diameter in pixels. */
  public minPixelSize: number;
  /** Largest on-screen marker diameter in pixels. */
  public maxPixelSize: number;
  /**
   * Draw only the points in a z range, optionally flattened onto its center
   * plane. Applied per draw, so moving or resizing the slab (e.g. following
   * an image's z slice) needs no rebuild. `null` (the default) draws every
   * point at its own z.
   */
  public depthSlab: PointDepthSlab | null = null;

  /**
   * Creates a renderable drawing one marker per entry.
   *
   * @param points - The points to draw.
   * @param options - Size units and scaling.
   */
  constructor(points: PointProps[], options: PointsRenderableOptions = {}) {
    super();
    this.sizeUnits = options.sizeUnits ?? "pixels";
    this.sizeScale = options.sizeScale ?? 1;
    this.minPixelSize = options.minPixelSize ?? 0;
    this.maxPixelSize = options.maxPixelSize ?? Infinity;
    this.programName = "points";
    this.depthProgramName = "pointsDepth";

    const vertexData = points.flatMap((point) => {
      const color = Color.from(point.color);
      return [
        point.position[0],
        point.position[1],
        point.position[2],
        color.r,
        color.g,
        color.b,
        color.a,
        point.size,
        MARKER_INDEX[point.marker],
      ];
    });
    const geometry = new Geometry(vertexData, [], "points");

    geometry.addAttribute({
      type: "position",
      itemSize: 3,
      offset: 0,
    });
    geometry.addAttribute({
      type: "color",
      itemSize: 4,
      offset: geometry.strideBytes,
    });
    geometry.addAttribute({
      type: "size",
      itemSize: 1,
      offset: geometry.strideBytes,
    });
    geometry.addAttribute({
      type: "marker",
      itemSize: 1,
      offset: geometry.strideBytes,
    });

    this.geometry = geometry;
    this.setTexture(0, getMarkerAtlas());
  }

  /** World bounds, flattened onto the slab center when the slab flattens
   *  (so culling matches where points are drawn). */
  public override get boundingBox() {
    if (!this.depthSlab?.flatten) return super.boundingBox;
    const box = this.geometry.boundingBox.clone();
    box.min[2] = box.max[2] = this.depthSlab.center;
    box.applyTransform(this.transform.matrix);
    return box;
  }

  /** Identifies the renderable type as `PointsRenderable`. */
  public get type() {
    return "PointsRenderable";
  }

  /** Returns the size and depth slab uniforms for the points shaders. */
  public override getUniforms() {
    const slab = this.depthSlab;
    const halfThickness = slab ? slab.thickness / 2 : Infinity;
    return {
      u_slabCenter: slab?.center ?? 0,
      u_slabHalfThickness: Number.isFinite(halfThickness)
        ? halfThickness
        : NO_SLAB_LIMIT,
      u_slabFlatten: Number(slab?.flatten ?? false),
      u_sizeInWorld: Number(this.sizeUnits === "world"),
      u_sizeScale: this.sizeScale,
      u_minPointSize: this.minPixelSize,
      // GLSL has no infinity literal; any value past the GPU cap is no limit.
      u_maxPointSize: Number.isFinite(this.maxPixelSize)
        ? this.maxPixelSize
        : NO_MAX_POINT_SIZE,
    };
  }
}

const NO_MAX_POINT_SIZE = 1e6;
// Larger than any coordinate (and inf where mediump overflows, which also keeps every point).
const NO_SLAB_LIMIT = 1e30;

let markerAtlas: Texture2DArray | undefined;

// The marker atlas is a fixed set of sprites shared by all PointsRenderable instances.
// Each marker in `Marker` maps to a slice in the atlas (see `MARKER_INDEX`).
function getMarkerAtlas(): Texture2DArray {
  if (!markerAtlas) {
    markerAtlas = createMarkerAtlas();
  }
  return markerAtlas;
}

function createMarkerAtlas(): Texture2DArray {
  const square = (size: number) => {
    const data = new Float32Array(size * size);
    data.fill(1.0);
    return data;
  };

  const circle = (size: number) => {
    const data = new Float32Array(size * size);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if ((i - size / 2) ** 2 + (j - size / 2) ** 2 < (size / 2) ** 2) {
          data[i * size + j] = 1.0;
        }
      }
    }
    return data;
  };

  const triangle = (size: number) => {
    const data = new Float32Array(size * size);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (j >= (size - i) / 2 && j <= (size + i) / 2) {
          data[i * size + j] = 1.0;
        }
      }
    }
    return data;
  };

  const SPRITE_SIZE = 256;
  const pixelsPerMarkerSprite = SPRITE_SIZE * SPRITE_SIZE;
  const sprites: Record<Marker, Float32Array> = {
    circle: circle(SPRITE_SIZE),
    square: square(SPRITE_SIZE),
    triangle: triangle(SPRITE_SIZE),
  };

  const numMarkers = Object.keys(sprites).length;
  const data = new Float32Array(numMarkers * pixelsPerMarkerSprite);
  for (const [marker, sprite] of Object.entries(sprites) as [
    Marker,
    Float32Array,
  ][]) {
    data.set(sprite, MARKER_INDEX[marker] * pixelsPerMarkerSprite);
  }

  // TODO: this uses f32 values, which are not (by default) filterable in WebGL2
  // to enable this, we can check/add OES_texture_float_linear.
  // we also don't need the precision of f32 for this so I'd like to use an R8
  // texture instead, but our Texture class does not yet support it.
  const texture = new Texture2DArray(data, SPRITE_SIZE, SPRITE_SIZE);
  texture.wrapR = "clamp_to_edge";
  texture.wrapS = "clamp_to_edge";
  texture.wrapT = "clamp_to_edge";
  return texture;
}
