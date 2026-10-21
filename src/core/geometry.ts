import { Node } from "./node";
import { Box3 } from "../math/box3";
import { vec3 } from "gl-matrix";

export type Primitive = "triangles" | "points" | "lines";

type GeometryAttributeType =
  | "position"
  | "normal"
  | "uv"
  | "next_position"
  | "previous_position"
  | "direction"
  | "color"
  | "size"
  | "marker";

export const GeometryAttributeIndex: Record<GeometryAttributeType, number> = {
  position: 0,
  normal: 1,
  uv: 2,
  next_position: 3,
  previous_position: 4,
  direction: 5,
  color: 6,
  size: 7,
  marker: 8,
};

type GeometryAttribute = {
  type: GeometryAttributeType;
  itemSize: number;
  offset: number;
};

export class Geometry extends Node {
  public instanceCount: number | null = null;
  private boundingBox_: Box3 | null = null;
  protected primitive_: Primitive;
  protected attributes_: GeometryAttribute[];
  protected vertexData_: Float32Array;
  protected indexData_: Uint32Array;

  constructor(
    vertexData: number[] | Float32Array = [],
    indexData: number[] | Uint32Array = [],
    primitive: Primitive = "triangles"
  ) {
    super();
    this.vertexData_ =
      vertexData instanceof Float32Array
        ? vertexData
        : new Float32Array(vertexData);
    this.indexData_ =
      indexData instanceof Uint32Array ? indexData : new Uint32Array(indexData);
    this.primitive_ = primitive;
    this.attributes_ = [];
  }

  public addAttribute(attr: GeometryAttribute) {
    this.attributes_.push(attr);
    this.boundingBox_ = null;
  }

  public get vertexCount() {
    return this.vertexData_.byteLength / this.strideBytes;
  }

  public get stride() {
    return this.attributes_.reduce((acc, curr) => {
      return acc + curr.itemSize;
    }, 0);
  }

  public get strideBytes() {
    return this.stride * Float32Array.BYTES_PER_ELEMENT;
  }

  public get primitive() {
    return this.primitive_;
  }

  public get vertexData() {
    return this.vertexData_;
  }

  public get indexData() {
    return this.indexData_;
  }

  public get attributes() {
    return this.attributes_;
  }

  public get boundingBox() {
    if (this.boundingBox_ === null) {
      const attr = this.getAttribute("position");
      if (!attr || this.vertexCount === 0) {
        throw new Error("Failed to generate bounding box");
      }

      const offset = (attr.offset ?? 0) / Float32Array.BYTES_PER_ELEMENT;
      const box = new Box3();
      const point = vec3.create();
      for (let i = 0; i < this.vertexData_.length; i += this.stride) {
        point[0] = this.vertexData_[i + offset + 0];
        point[1] = this.vertexData_[i + offset + 1];
        point[2] = this.vertexData_[i + offset + 2];
        box.expandWithPoint(point);
      }

      this.boundingBox_ = box;
    }
    return this.boundingBox_;
  }

  public get type() {
    return "Geometry";
  }

  private getAttribute(type: GeometryAttributeType) {
    return this.attributes_.find((a) => a.type === type);
  }
}
