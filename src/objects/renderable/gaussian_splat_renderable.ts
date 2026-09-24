import { RenderableObject } from "../../core/renderable_object";
import { Box3 } from "../../math/box3";
import { PlaneGeometry } from "../geometry/plane_geometry";
import { Texture2D } from "../textures/texture_2d";
import { PACKED_SPLAT_UINTS } from "../../data/luxar/decode";

const MAX_TEXTURE_WIDTH = 4096;

function textureShape(texels: number) {
  const width = Math.max(1, Math.min(MAX_TEXTURE_WIDTH, texels));
  const height = Math.max(1, Math.ceil(texels / width));
  return { width, height };
}

/**
 * Returns the length of a splat buffer that fills the splat texture for a
 * given number of splats. Buffers of this length are uploaded without a copy.
 *
 * @param count - The number of splats.
 */
export function splatDataLength(count: number) {
  const { width, height } = textureShape((count * PACKED_SPLAT_UINTS) / 4);
  return width * height * 4;
}

/**
 * Returns the length of an order buffer that fills the order texture for a
 * given number of splats.
 *
 * @param count - The number of splats.
 */
export function splatOrderLength(count: number) {
  const { width, height } = textureShape(count);
  return width * height;
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
  private splats_: Texture2D;
  private order_: Texture2D;
  private count_ = 0;
  private bounds_ = new Box3();

  /**
   * @param colormap - A 256 x 1 RGBA lookup table for coloring splats by
   *   amplitude.
   */
  constructor(colormap: Texture2D) {
    super();
    this.programName = "gaussianSplat";
    this.depthTest = true;

    const geometry = new PlaneGeometry(2, 2, 1, 1);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    this.splats_ = createSplatTexture(new Uint32Array(0), 0);
    this.order_ = createOrderTexture(0);
    this.setTexture(0, this.splats_);
    this.setTexture(1, this.order_);
    this.setTexture(2, colormap);
  }

  public get type() {
    return "GaussianSplatRenderable";
  }

  /** The number of splats held. */
  public get count() {
    return this.count_;
  }

  public override get boundingBox() {
    return this.bounds_.clone();
  }

  /**
   * Replaces the splats and resets the draw order to storage order.
   *
   * @param data - Packed splats, see {@link PackedSplats.data}. Pad to
   *   {@link splatDataLength} to avoid a copy.
   * @param count - The number of splats in `data`.
   * @param bounds - World-space bounds enclosing the splats.
   */
  public setSplats(data: Uint32Array, count: number, bounds: Box3) {
    this.markStaleTexture(this.splats_);
    this.markStaleTexture(this.order_);
    this.splats_ = createSplatTexture(data, count);
    this.order_ = createOrderTexture(count);
    this.setTexture(0, this.splats_);
    this.setTexture(1, this.order_);
    this.count_ = count;
    this.bounds_ = bounds.clone();
    this.geometry.instanceCount = count;
  }

  /** The number of splats drawn, which may exclude culled splats. */
  public get drawCount() {
    return this.geometry.instanceCount ?? 0;
  }

  /**
   * Sets which splats are drawn and in what order.
   *
   * @param order - Splat indices in draw order, with length
   *   {@link splatOrderLength} of the current count.
   * @param drawCount - The number of leading entries of `order` to draw.
   */
  public setOrder(order: Uint32Array, drawCount: number) {
    if (order.length !== splatOrderLength(this.count_)) {
      throw new Error(
        `Order of length ${order.length} does not match ${this.count_} splats`
      );
    }
    this.order_.data = order;
    this.geometry.instanceCount = drawCount;
  }

  /**
   * Replaces the colormap lookup table.
   *
   * @param colormap - A 256 x 1 RGBA lookup table.
   */
  public setColormap(colormap: Texture2D) {
    this.markStaleTexture(this.textures[2]);
    this.setTexture(2, colormap);
  }

  public override getUniforms() {
    return { u_splats: 0, u_order: 1, u_colormap: 2 };
  }
}

function createSplatTexture(data: Uint32Array, count: number) {
  const { width, height } = textureShape((count * PACKED_SPLAT_UINTS) / 4);
  let padded = data;
  if (data.length !== width * height * 4) {
    padded = new Uint32Array(width * height * 4);
    padded.set(data.subarray(0, count * PACKED_SPLAT_UINTS));
  }
  const texture = new Texture2D(padded, width, height);
  texture.dataFormat = "rgba";
  return texture;
}

function createOrderTexture(count: number) {
  const { width, height } = textureShape(count);
  const order = new Uint32Array(width * height);
  for (let i = 0; i < count; i++) order[i] = i;
  return new Texture2D(order, width, height);
}
