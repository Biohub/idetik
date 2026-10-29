import { vec3 } from "gl-matrix";

import { Color, ColorLike } from "../../math/color";
import { RenderableObject } from "../../core/renderable_object";
import { Texture2DArray } from "../textures/texture_2d_array";
import { Geometry } from "../../core/geometry";
import { Box3 } from "../../math/box3";
import { Plane } from "../../math/plane";

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
   * fixed size on screen; `"world"` makes `size` a diameter in the same
   * units as the positions, so markers grow and shrink with zoom (and with
   * distance in perspective) and scale with the renderable's transform.
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
  /**
   * Outline width of hollow markers (see {@link PointDepthSlab.behind}), in
   * `sizeUnits`, so world-sized markers get world-sized outlines (never
   * thinner than one pixel). Defaults to `2.5`, which suits pixel-sized
   * markers; set it for world-sized ones.
   */
  outlineWidth?: number;
};

/**
 * A slab of space around a plane, for {@link PointsRenderable.depthSlab}, in
 * the renderable's model space (before its transform).
 */
export type PointDepthSlab = {
  /** The slab's mid-plane, e.g. the plane of the image slice the points are
   *  drawn over. Any orientation; mutate it in place to follow the slice. */
  plane: Plane;
  /** Full thickness; points farther than half of it from the plane are not
   *  drawn. `Infinity` keeps every point (useful with `flatten`). */
  thickness: number;
  /**
   * Draw the kept points on the plane instead of at their own position, e.g.
   * to overlay a slab of a 3D point cloud on a 2D image slice. Defaults to
   * `false`.
   */
  flatten?: boolean;
  /**
   * How points fade with distance from the plane. `"none"` (the default)
   * draws every kept point in full. `"linear"` fades opacity to zero at the
   * slab's faces. `"sphere"` scales size and opacity by the cross-section of
   * a ball spanning the slab, so markers swell as the plane passes through
   * them and shrink away toward the faces.
   */
  falloff?: "none" | "linear" | "sphere";
  /**
   * How points on the far side of the plane (against its normal) are drawn.
   * `"solid"` (the default) draws them like the rest; `"hollow"` draws only
   * their outline ({@link PointsRenderable.outlineWidth} wide), so the
   * slice reads as lying in front of them. Orient the normal toward the
   * viewer.
   */
  behind?: "solid" | "hollow";
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
   * Draw only the points within a slab around a plane, optionally flattened
   * onto it and fading toward its faces. Applied per draw, so moving or
   * resizing the slab (e.g. following an image slice) needs no rebuild.
   * `null` (the default) draws every point where it is.
   */
  public depthSlab: PointDepthSlab | null = null;
  /** Outline width of hollow markers, in {@link sizeUnits}. */
  public outlineWidth: number;

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
    this.outlineWidth = options.outlineWidth ?? 2.5;
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

  /** World bounds, projected onto the slab plane when the slab flattens
   *  (so culling matches where points are drawn). */
  public override get boundingBox() {
    const slab = this.depthSlab;
    const local = this.geometry.boundingBox;
    // A geometry with no points has an inverted box; leave it alone.
    if (!slab?.flatten || local.min[0] > local.max[0]) return super.boundingBox;
    const { normal, signedDistance } = slab.plane;
    const box = new Box3();
    const corner = vec3.create();
    for (let i = 0; i < 8; i++) {
      vec3.set(
        corner,
        (i & 1 ? local.max : local.min)[0],
        (i & 2 ? local.max : local.min)[1],
        (i & 4 ? local.max : local.min)[2]
      );
      const dist = vec3.dot(corner, normal) + signedDistance;
      vec3.scaleAndAdd(corner, corner, normal, -dist);
      box.expandWithPoint(corner);
    }
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
      u_slabNormal: slab?.plane.normal ?? DEFAULT_SLAB_NORMAL,
      u_slabDistance: slab?.plane.signedDistance ?? 0,
      u_slabHalfThickness: Number.isFinite(halfThickness)
        ? halfThickness
        : NO_SLAB_LIMIT,
      u_slabFlatten: Number(slab?.flatten ?? false),
      u_slabFalloff: SLAB_FALLOFF[slab?.falloff ?? "none"],
      u_slabBehindHollow: Number(slab?.behind === "hollow"),
      u_outlineWidth: this.outlineWidth,
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
const DEFAULT_SLAB_NORMAL = vec3.fromValues(0, 0, 1);
const SLAB_FALLOFF = { none: 0, linear: 1, sphere: 2 } as const;

let markerAtlas: Texture2DArray | undefined;

// The marker atlas is a fixed set of sprites shared by all PointsRenderable instances.
// Each marker in `Marker` maps to a slice in the atlas (see `MARKER_INDEX`).
function getMarkerAtlas(): Texture2DArray {
  if (!markerAtlas) {
    markerAtlas = createMarkerAtlas();
  }
  return markerAtlas;
}

// Each sprite stores the signed distance to the marker's edge, in sprite
// units (the sprite spans 1.0), negative inside. The fragment shader turns
// it into coverage with a one-pixel smoothstep, so edges are antialiased at
// any on-screen size and markers can be drawn much larger than the sprite.
const SPRITE_SIZE = 256;

type Sdf = (x: number, y: number) => number;

// Circle of diameter 1 at the sprite center.
const circleSdf: Sdf = (x, y) => Math.hypot(x - 0.5, y - 0.5) - 0.5;

// Axis-aligned unit square (exact outside the corners too).
const squareSdf: Sdf = (x, y) => {
  const qx = Math.abs(x - 0.5) - 0.5;
  const qy = Math.abs(y - 0.5) - 0.5;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
  );
};

// Isosceles triangle: apex at the top center, base along the bottom edge.
const TRIANGLE: [number, number][] = [
  [0.5, 0],
  [1, 1],
  [0, 1],
];
const triangleSdf: Sdf = (x, y) => polygonSdf(TRIANGLE, x, y);

/** Signed distance to a simple polygon: edge distance, negative inside. */
function polygonSdf(vertices: [number, number][], x: number, y: number) {
  let d2 = Infinity;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [ax, ay] = vertices[j];
    const [bx, by] = vertices[i];
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey))
    );
    const dx = x - (ax + t * ex);
    const dy = y - (ay + t * ey);
    d2 = Math.min(d2, dx * dx + dy * dy);
    // Even-odd crossing test.
    if (ay > y !== by > y && x < ax + ((y - ay) * ex) / ey) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(d2);
}

function createMarkerAtlas(): Texture2DArray {
  const sdfs: Record<Marker, Sdf> = {
    circle: circleSdf,
    square: squareSdf,
    triangle: triangleSdf,
  };
  const pixelsPerSprite = SPRITE_SIZE * SPRITE_SIZE;
  const numMarkers = Object.keys(sdfs).length;
  // Half floats are filterable in WebGL2 (plain floats are not), so the
  // distance can be sampled linearly when a marker is magnified past the
  // sprite. Fall back to floats with nearest sampling where Float16Array is
  // missing; minified markers still antialias since the distance varies
  // smoothly across texels.
  const halfFloat = typeof Float16Array !== "undefined";
  const data = halfFloat
    ? new Float16Array(numMarkers * pixelsPerSprite)
    : new Float32Array(numMarkers * pixelsPerSprite);
  for (const [marker, sdf] of Object.entries(sdfs) as [Marker, Sdf][]) {
    const offset = MARKER_INDEX[marker] * pixelsPerSprite;
    for (let i = 0; i < SPRITE_SIZE; i++) {
      const y = (i + 0.5) / SPRITE_SIZE;
      for (let j = 0; j < SPRITE_SIZE; j++) {
        data[offset + i * SPRITE_SIZE + j] = sdf((j + 0.5) / SPRITE_SIZE, y);
      }
    }
  }

  const texture = new Texture2DArray(data, SPRITE_SIZE, SPRITE_SIZE);
  const filter = halfFloat ? "linear" : "nearest";
  texture.minFilter = filter;
  texture.maxFilter = filter;
  texture.wrapR = "clamp_to_edge";
  texture.wrapS = "clamp_to_edge";
  texture.wrapT = "clamp_to_edge";
  return texture;
}
