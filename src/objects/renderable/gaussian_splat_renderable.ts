import { mat4 } from "gl-matrix";

import { RenderableObject } from "../../core/renderable_object";
import { PlaneGeometry } from "../geometry/plane_geometry";
import { Texture2D } from "../textures/texture_2d";
import { GaussianSplats, SPLAT_WORDS } from "../../data/gaussian_splats";

const MAX_TEXTURE_WIDTH = 4096;

// One texture per set of splats, so layers on the same source share GPU
// memory.
const splatTextures = new WeakMap<GaussianSplats, Texture2D>();

function textureShape(texels: number) {
  const width = Math.max(1, Math.min(MAX_TEXTURE_WIDTH, texels));
  const height = Math.max(1, Math.ceil(texels / width));
  return { width, height };
}

/**
 * A set of 3D Gaussian splats drawn as instanced screen-space quads.
 *
 * Splat data lives in an integer texture read by the vertex shader, and a
 * second texture maps each instance to the splat it draws so the draw order
 * can change without re-uploading the splats.
 *
 * @group Renderables
 */
export class GaussianSplatRenderable extends RenderableObject {
  private readonly splats_: GaussianSplats;
  private readonly positions_: Float32Array;
  private readonly order_: Texture2D;
  private readonly orderData_: Uint32Array;
  private readonly depths_: Float32Array;

  /** @param splats - The splats to draw. */
  constructor(splats: GaussianSplats) {
    super();
    this.programName = "gaussianSplat";

    const geometry = new PlaneGeometry(2, 2, 1, 1);
    geometry.instanceCount = splats.count;
    this.geometry = geometry;

    this.splats_ = splats;
    this.positions_ = new Float32Array(splats.data.buffer);
    this.orderData_ = createIdentityOrder(splats.count);
    this.order_ = createOrderTexture(this.orderData_, splats.count);
    this.depths_ = new Float32Array(splats.count);
    this.setTexture(0, getSplatTexture(splats));
    this.setTexture(1, this.order_);
  }

  public get type() {
    return "GaussianSplatRenderable";
  }

  public override get boundingBox() {
    const box = this.splats_.extent.clone();
    box.applyTransform(this.transform.matrix);
    return box;
  }

  /**
   * Orders the splats back to front for a model-view matrix.
   *
   * @param modelView - The model-view matrix of the view to sort for.
   */
  public sortBackToFront(modelView: mat4) {
    const viewZ = [modelView[2], modelView[6], modelView[10], modelView[14]];
    sortSplatsBackToFront(
      this.positions_,
      SPLAT_WORDS,
      viewZ,
      this.orderData_,
      this.depths_
    );
    this.order_.data = this.orderData_;
  }

  public override getUniforms() {
    return { u_splats: 0, u_order: 1 };
  }
}

function getSplatTexture(splats: GaussianSplats) {
  let texture = splatTextures.get(splats);
  if (texture) return texture;
  const { width, height } = textureShape(splats.data.length / 4);
  const padded = new Uint32Array(width * height * 4);
  padded.set(splats.data);
  texture = new Texture2D(padded, width, height);
  texture.dataFormat = "rgba";
  splatTextures.set(splats, texture);
  return texture;
}

function createIdentityOrder(count: number) {
  const { width, height } = textureShape(count);
  const order = new Uint32Array(width * height);
  for (let i = 0; i < count; i++) order[i] = i;
  return order;
}

function createOrderTexture(order: Uint32Array, count: number) {
  const { width, height } = textureShape(count);
  return new Texture2D(order, width, height);
}

const SORT_BUCKETS = 1 << 16;

/**
 * Orders splats back to front along the view direction with a 16-bit
 * counting sort on view-space depth.
 *
 * @param positions - Splat centers as `x, y, z` at the start of every
 *   `stride` floats.
 * @param stride - Floats per splat in `positions`.
 * @param viewZ - The third row of the model-view matrix, which maps a center
 *   to its view-space z. Farther splats have more negative z.
 * @param out - Receives the splat indices in draw order.
 * @param depths - Scratch space with one entry per splat.
 */
function sortSplatsBackToFront(
  positions: Float32Array,
  stride: number,
  viewZ: ArrayLike<number>,
  out: Uint32Array,
  depths: Float32Array
) {
  const count = positions.length / stride;
  const [a, b, c, d] = [viewZ[0], viewZ[1], viewZ[2], viewZ[3]];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < count; i++) {
    const p = i * stride;
    const z =
      a * positions[p] + b * positions[p + 1] + c * positions[p + 2] + d;
    depths[i] = z;
    if (z < min) min = z;
    if (z > max) max = z;
  }

  const scale = max > min ? (SORT_BUCKETS - 1) / (max - min) : 0;
  const counts = new Uint32Array(SORT_BUCKETS);
  for (let i = 0; i < count; i++) {
    const key = ((depths[i] - min) * scale) | 0;
    depths[i] = key;
    counts[key]++;
  }
  let offset = 0;
  for (let k = 0; k < SORT_BUCKETS; k++) {
    const n = counts[k];
    counts[k] = offset;
    offset += n;
  }
  for (let i = 0; i < count; i++) {
    out[counts[depths[i]]++] = i;
  }
}
