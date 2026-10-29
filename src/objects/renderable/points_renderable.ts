import { mat4, vec3 } from "gl-matrix";

import { Color, ColorLike } from "../../math/color";
import { RenderableObject } from "../../core/renderable_object";
import { Texture2D } from "../textures/texture_2d";
import { Texture2DArray } from "../textures/texture_2d_array";
import { Geometry } from "../../core/geometry";
import { Plane } from "../../math/plane";
import { clamp } from "../../utilities/clamp";

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
};

/** A category's appearance in a {@link PointCategoryTable}. */
export type PointCategoryStyle = {
  /** Marker color; its alpha multiplies the layer opacity. */
  color: ColorLike;
  /** Whether points of this category are drawn. Defaults to `true`. */
  visible?: boolean;
};

// Texture rows wrap at this width; 4096 is within every WebGL2 limit.
const CATEGORY_TABLE_WIDTH = 4096;

/**
 * Colors and visibility for categorical points: one entry per category,
 * stored in a small RGBA texture that every {@link PointsRenderable} built
 * with {@link PointsRenderable.categorical} reads per point. Share one
 * table across many renderables (e.g. all tiles of a layer): editing it
 * restyles all of them on the next frame without touching their geometry.
 *
 * Categories are just integers; what they mean (genes, particle classes,
 * annotation labels, ...) is up to the caller.
 *
 * @group Renderables
 */
export class PointCategoryTable {
  /** Number of categories; valid indices are `0 .. count - 1`. */
  public readonly count: number;
  /** The RGBA texture the shader reads. Bound by categorical renderables. */
  public readonly texture: Texture2D;
  private readonly rgba_: Uint8Array;
  private readonly visible_: Uint8Array;
  private readonly alpha_: Uint8Array;

  /**
   * @param count - Number of categories.
   * @param style - Initial style per category. Defaults to visible white.
   */
  constructor(count: number, style?: (category: number) => PointCategoryStyle) {
    this.count = count;
    const width = Math.max(1, Math.min(count, CATEGORY_TABLE_WIDTH));
    const height = Math.max(1, Math.ceil(count / width));
    this.rgba_ = new Uint8Array(width * height * 4);
    this.visible_ = new Uint8Array(count).fill(1);
    this.alpha_ = new Uint8Array(count).fill(255);
    for (let i = 0; i < count; i++) {
      const s = style?.(i) ?? { color: Color.WHITE };
      this.writeColor(i, s.color);
      this.visible_[i] = s.visible === false ? 0 : 1;
      this.writeAlpha(i);
    }
    this.texture = new Texture2D(this.rgba_, width, height);
    this.texture.dataFormat = "rgba";
  }

  /** Whether points of `category` are drawn. */
  public isVisible(category: number): boolean {
    return this.visible_[category] === 1;
  }

  public setVisible(category: number, visible: boolean): void {
    this.visible_[category] = visible ? 1 : 0;
    this.writeAlpha(category);
    this.texture.needsUpdate = true;
  }

  /** Set every category's visibility at once (one texture upload). */
  public setVisibility(visible: (category: number) => boolean): void {
    for (let i = 0; i < this.count; i++) {
      this.visible_[i] = visible(i) ? 1 : 0;
      this.writeAlpha(i);
    }
    this.texture.needsUpdate = true;
  }

  public setColor(category: number, color: ColorLike): void {
    this.writeColor(category, color);
    this.writeAlpha(category);
    this.texture.needsUpdate = true;
  }

  private writeColor(category: number, color: ColorLike) {
    const c = Color.from(color);
    const o = category * 4;
    this.rgba_[o] = Math.round(c.r * 255);
    this.rgba_[o + 1] = Math.round(c.g * 255);
    this.rgba_[o + 2] = Math.round(c.b * 255);
    this.alpha_[category] = Math.round(c.a * 255);
  }

  // Alpha 0 means hidden: the shader skips those points entirely.
  private writeAlpha(category: number) {
    this.rgba_[category * 4 + 3] = this.visible_[category]
      ? Math.max(1, this.alpha_[category])
      : 0;
  }
}

/**
 * Input to {@link PointsRenderable.categorical}: typed arrays, so large
 * point sets avoid building one object per point.
 */
export type CategoricalPointsProps = {
  /** World positions, x/y/z interleaved (3 values per point). */
  positions: ArrayLike<number>;
  /** Category index per point, into `table`. */
  categories: ArrayLike<number>;
  /** Colors and visibility per category; may be shared. */
  table: PointCategoryTable;
  /** Marker size for every point, or one per point (in `sizeUnits`). */
  size: number | ArrayLike<number>;
  /** Marker shape for every point. Defaults to `"circle"`. */
  marker?: Marker;
};

/**
 * A set of point markers drawn as screen-space sprites.
 *
 * Each point has a world-space position, a color, a size, and a marker
 * shape. Sizes are in screen pixels unless {@link sizeUnits} is `"world"`. All instances share a single marker sprite atlas. The
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
  /**
   * Creates points styled by category: each point's color and visibility
   * come from a shared {@link PointCategoryTable}, so they can change
   * without rebuilding geometry. Same layout and program as the
   * constructor, which builds its own table from the points' colors.
   *
   * ```ts
   * const table = new PointCategoryTable(classes.length, (i) => ({ color: palette[i] }));
   * const points = PointsRenderable.categorical({ positions, categories, table, size: 4 });
   * table.setVisible(2, false); // hide class 2 everywhere the table is used
   * ```
   *
   * @param props - Positions, categories, the table, and marker size/shape.
   * @param options - Size units and scaling, as for the constructor.
   */
  public static categorical(
    props: CategoricalPointsProps,
    options: PointsRenderableOptions = {}
  ): PointsRenderable {
    const { positions, categories, table, size } = props;
    const n = categories.length;
    if (positions.length !== n * 3) {
      throw new Error(
        `Expected ${n * 3} position values for ${n} points, got ${positions.length}`
      );
    }
    const sizes =
      typeof size === "number" ? new Float32Array(n).fill(size) : size;
    const markers = new Float32Array(n).fill(
      MARKER_INDEX[props.marker ?? "circle"]
    );
    const points = new PointsRenderable([], options);
    points.geometry = buildGeometry(positions, sizes, markers, categories);
    points.useTable(table);
    return points;
  }

  private categoryTable_?: PointCategoryTable;

  /** The category table: the caller's for {@link categorical}, otherwise an
   *  internal one with an entry per distinct point color. */
  public get categoryTable(): PointCategoryTable | undefined {
    return this.categoryTable_;
  }

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

    // Colors go through a lookup table like categorical points: each
    // distinct color (as RGBA8) becomes one entry, and points store its index.
    const colors: Color[] = [];
    const indexOf = new Map<number, number>();
    const n = points.length;
    const positions = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const markers = new Float32Array(n);
    const categories = new Float32Array(n);
    points.forEach((point, i) => {
      const color = Color.from(point.color);
      const key = color.packed;
      let index = indexOf.get(key);
      if (index === undefined) {
        index = colors.length;
        indexOf.set(key, index);
        colors.push(color);
      }
      positions.set(
        [point.position[0], point.position[1], point.position[2]],
        i * 3
      );
      sizes[i] = point.size;
      markers[i] = MARKER_INDEX[point.marker];
      categories[i] = index;
    });
    this.useTable(
      new PointCategoryTable(colors.length, (i) => ({ color: colors[i] }))
    );
    this.geometry = buildGeometry(positions, sizes, markers, categories);
    this.setTexture(0, getMarkerAtlas());
  }

  private useTable(table: PointCategoryTable) {
    this.categoryTable_ = table;
    this.setTexture(1, table.texture);
  }

  /** World bounds, projected onto the slab plane when the slab flattens
   *  (so culling matches where points are drawn). */
  public override get boundingBox() {
    const slab = this.depthSlab;
    const local = this.geometry.boundingBox;
    // A geometry with no points has an inverted box; leave it alone. (Not
    // `isEmpty()`: a flat set of points is a zero-thickness box, which is
    // exactly the case to project.)
    if (!slab?.flatten || local.min[0] > local.max[0]) return super.boundingBox;
    // Projecting onto the plane is affine, p - (n . p + d) n, so compose it
    // with the transform and let Box3 take the corners.
    const [nx, ny, nz] = slab.plane.normal;
    const d = slab.plane.signedDistance;
    // prettier-ignore
    mat4.set(PROJECT_ONTO_PLANE,
      1 - nx * nx, -ny * nx, -nz * nx, 0,
      -nx * ny, 1 - ny * ny, -nz * ny, 0,
      -nx * nz, -ny * nz, 1 - nz * nz, 0,
      -d * nx, -d * ny, -d * nz, 1);
    const box = local.clone();
    box.applyTransform(
      mat4.multiply(
        PROJECT_ONTO_PLANE,
        this.transform.matrix,
        PROJECT_ONTO_PLANE
      )
    );
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
      u_slabHalfThickness: finiteOr(halfThickness, GLSL_INFINITY),
      u_slabFlatten: Number(slab?.flatten ?? false),
      u_slabFalloff: SLAB_FALLOFF[slab?.falloff ?? "none"],
      u_sizeInWorld: Number(this.sizeUnits === "world"),
      u_sizeScale: this.sizeScale,
      u_minPointSize: this.minPixelSize,
      u_categoryTable: 1,
      u_maxPointSize: finiteOr(this.maxPixelSize, GLSL_INFINITY),
    };
  }
}

// GLSL has no infinity literal; this stands in for "no limit" in highp.
const GLSL_INFINITY = 1e30;
const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;
const DEFAULT_SLAB_NORMAL = vec3.fromValues(0, 0, 1);
const PROJECT_ONTO_PLANE = mat4.create();
const SLAB_FALLOFF = { none: 0, linear: 1, sphere: 2 } as const;

/** Interleaved points geometry, 24 bytes per vertex: position (3), size,
 *  marker and category (an index into the renderable's category table). */
function buildGeometry(
  positions: ArrayLike<number>,
  sizes: ArrayLike<number>,
  markers: ArrayLike<number>,
  categories: ArrayLike<number>
): Geometry {
  const n = categories.length;
  const stride = 6;
  const data = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    data[o] = positions[i * 3];
    data[o + 1] = positions[i * 3 + 1];
    data[o + 2] = positions[i * 3 + 2];
    data[o + 3] = sizes[i];
    data[o + 4] = markers[i];
    data[o + 5] = categories[i];
  }
  const geometry = new Geometry(data, [], "points");
  geometry.addAttribute({ type: "position", itemSize: 3, offset: 0 });
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
  geometry.addAttribute({
    type: "category",
    itemSize: 1,
    offset: geometry.strideBytes,
  });
  return geometry;
}

let markerAtlas: Texture2DArray | undefined;

// The marker atlas is a fixed set of sprites shared by all PointsRenderable instances.
// Each marker in `Marker` maps to a slice in the atlas (see `MARKER_INDEX`).
function getMarkerAtlas(): Texture2DArray {
  if (!markerAtlas) {
    markerAtlas = createMarkerAtlas();
  }
  return markerAtlas;
}

// Each sprite stores the signed distance to the marker's edge, in marker
// units (the marker spans 1.0), negative inside. The fragment shader turns
// it into coverage with a one-pixel smoothstep, so edges are antialiased at
// any on-screen size and markers can be drawn much larger than the sprite.
//
// The marker is inset to the middle MARKER_FRACTION of the sprite, so the
// field is also valid in a margin around it. Today the point sprite covers
// just the marker (the fragment shaders map it onto the inset); a later
// outer stroke or halo can enlarge the sprite by up to
// (1 - MARKER_FRACTION) / 2 of the marker per side and still read real
// distances, without touching the atlas.
const SPRITE_SIZE = 256;
// Keep in sync with MARKER_FRACTION in points_frag.glsl and points_depth_frag.glsl.
const MARKER_FRACTION = 0.5;

type Sdf = (x: number, y: number) => number;

// Circle of diameter 1 at the marker center.
const circleSdf: Sdf = (x, y) => Math.hypot(x - 0.5, y - 0.5) - 0.5;

// Unit square filling the marker.
const SQUARE: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const squareSdf: Sdf = (x, y) => polygonSdf(SQUARE, x, y);

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
    const t = clamp(
      ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey),
      0,
      1
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
    // Sprite texel centers, mapped into marker space (the marker spans
    // [0, 1] over the middle MARKER_FRACTION of the sprite).
    const toMarker = (texel: number) =>
      0.5 + ((texel + 0.5) / SPRITE_SIZE - 0.5) / MARKER_FRACTION;
    for (let i = 0; i < SPRITE_SIZE; i++) {
      const y = toMarker(i);
      for (let j = 0; j < SPRITE_SIZE; j++) {
        data[offset + i * SPRITE_SIZE + j] = sdf(toMarker(j), y);
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
