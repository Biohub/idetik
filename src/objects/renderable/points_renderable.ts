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
  /** Marker size in pixels. */
  size: number;
  /** Marker shape. */
  marker: Marker;
};

/**
 * A set of point markers drawn as screen-space sprites.
 *
 * Each point has a world-space position, a color, a size in pixels, and a
 * marker shape. All instances share a single marker sprite atlas. The
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
   * Creates a renderable drawing one marker per entry.
   *
   * @param points - The points to draw.
   */
  constructor(points: PointProps[]) {
    super();
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

  /** Identifies the renderable type as `PointsRenderable`. */
  public get type() {
    return "PointsRenderable";
  }
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
