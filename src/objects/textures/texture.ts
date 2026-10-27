import { Node } from "../../core/node";

export type TextureFilter = "nearest" | "linear";

export type TextureWrapMode = "repeat" | "clamp_to_edge";

export type TextureDataFormat = "scalar" | "rgb" | "rgba";

export type TextureDataType =
  | "byte"
  | "short"
  | "int"
  | "unsigned_byte"
  | "unsigned_short"
  | "unsigned_int"
  | "float"
  | "half_float";

export type TextureUnpackRowAlignment = 1 | 2 | 4 | 8;

export type DataTextureTypedArray =
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Float32Array
  | Float16Array;

export function isTextureUnpackRowAlignment(
  value: number
): value is TextureUnpackRowAlignment {
  return value === 1 || value === 2 || value === 4 || value === 8;
}

export function bufferToDataType(
  buffer: DataTextureTypedArray
): TextureDataType {
  if (buffer instanceof Int8Array) {
    return "byte";
  } else if (buffer instanceof Int16Array) {
    return "short";
  } else if (buffer instanceof Int32Array) {
    return "int";
  } else if (buffer instanceof Uint8Array) {
    return "unsigned_byte";
  } else if (buffer instanceof Uint16Array) {
    return "unsigned_short";
  } else if (buffer instanceof Uint32Array) {
    return "unsigned_int";
  } else if (buffer instanceof Float32Array) {
    return "float";
  } else if (
    typeof Float16Array !== "undefined" &&
    buffer instanceof Float16Array
  ) {
    return "half_float";
  }
  throw new Error("Unsupported buffer type.");
}

export function textureChannelCount(texture: Texture) {
  switch (texture.dataFormat) {
    case "scalar":
      return 1;
    case "rgb":
      return 3;
    case "rgba":
      return 4;
  }
}

export function textureBytesPerChannel(texture: Texture) {
  switch (texture.dataType) {
    case "byte":
    case "unsigned_byte":
      return 1;
    case "short":
    case "unsigned_short":
    case "half_float":
      return 2;
    case "int":
    case "unsigned_int":
    case "float":
      return 4;
  }
}

export function textureStorageBytes(texture: Texture): number {
  const bytesPerTexel =
    textureChannelCount(texture) * textureBytesPerChannel(texture);

  const levels = Math.max(1, texture.mipmapLevels);

  let width = Math.max(1, texture.width);
  let height = Math.max(1, texture.height);
  let depth = Math.max(1, texture.depth);
  let total = 0;

  for (let i = 0; i < levels; ++i) {
    total += bytesPerTexel * depth * width * height;
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
    if (texture.type === "Texture3D") {
      depth = Math.max(1, depth >> 1);
    }
  }

  return total;
}

export function textureDefaultValueRange(texture: Texture): [number, number] {
  if (texture.dataFormat === "rgb" || texture.dataFormat === "rgba") {
    return [0, 1];
  }
  switch (texture.dataType) {
    case "byte":
      return [-128, 127];
    case "short":
      return [-32768, 32767];
    case "int":
      return [-2147483648, 2147483647];
    case "unsigned_byte":
      return [0, 255];
    case "unsigned_short":
      return [0, 65535];
    case "unsigned_int":
      return [0, 4294967295];
    case "float":
    case "half_float":
      return [0, 1];
  }
}

export abstract class Texture extends Node {
  public dataFormat: TextureDataFormat = "rgba";
  public dataType: TextureDataType = "unsigned_byte";
  public maxFilter: TextureFilter = "nearest";
  public minFilter: TextureFilter = "nearest";
  public mipmapLevels = 1;
  public unpackAlignment: TextureUnpackRowAlignment = 4;
  public wrapR: TextureWrapMode = "clamp_to_edge";
  public wrapS: TextureWrapMode = "clamp_to_edge";
  public wrapT: TextureWrapMode = "clamp_to_edge";
  public needsUpdate = true;

  // Reads a single texel back from GPU memory at (x, y, z). Injected by the
  // renderer when the texture is uploaded (and cleared on disposal).
  public readTexel?: (x: number, y: number, z: number) => Promise<number>;

  protected data_: DataTextureTypedArray | null = null;

  public get data(): DataTextureTypedArray | null {
    return this.data_;
  }

  public set data(data: DataTextureTypedArray) {
    this.data_ = data;
    this.needsUpdate = true;
  }

  public releaseCpuData(): void {
    this.data_ = null;
  }

  public abstract get width(): number;
  public abstract get height(): number;

  public get depth(): number {
    return 1;
  }

  public get type() {
    return "Texture";
  }
}
