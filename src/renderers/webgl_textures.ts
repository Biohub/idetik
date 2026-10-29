import { Logger } from "../utilities/logger";
import {
  textureStorageBytes,
  type Texture,
  type TextureFilter,
  type TextureWrapMode,
  type TextureDataType,
  type TextureDataFormat,
} from "../objects/textures/texture";

import { Texture2D } from "../objects/textures/texture_2d";
import { Texture2DArray } from "../objects/textures/texture_2d_array";
import { Texture3D } from "../objects/textures/texture_3d";

type TextureFormatInfo = {
  internalFormat: number;
  format: number;
  type: number;
};

export class WebGLTextures {
  private readonly gl_: WebGL2RenderingContext;
  private readonly textures_: Map<Texture, WebGLTexture> = new Map();
  private currentTexture_: Texture | null = null;
  private readonly maxTextureUnits_: number;
  private nextPersistentUnit_: number;
  private gpuTextureBytes_ = 0;
  private textureCount_ = 0;
  private readFramebuffer_: WebGLFramebuffer | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl_ = gl;
    this.maxTextureUnits_ = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    this.nextPersistentUnit_ = this.maxTextureUnits_ - 1;
  }

  public get gpuTextureBytes() {
    return this.gpuTextureBytes_;
  }

  public get textureCount() {
    return this.textureCount_;
  }

  public reservePersistentUnit(): number {
    if (this.nextPersistentUnit_ < 0) {
      throw new Error(
        `No texture units left to reserve (${this.maxTextureUnits_} total)`
      );
    }
    return this.nextPersistentUnit_--;
  }

  public bindTexture(texture: Texture, index: number) {
    if (this.alreadyActive(texture)) return;

    if (index < 0 || index > this.nextPersistentUnit_) {
      throw new Error(
        `Texture index ${index} must be in [0, ${this.nextPersistentUnit_}]; ` +
          `units above that are reserved`
      );
    }

    const textureId = this.textures_.get(texture);
    if (textureId && !texture.needsUpdate) {
      this.gl_.activeTexture(this.gl_.TEXTURE0 + index);
      this.gl_.bindTexture(this.getTextureType(texture), textureId);
    } else {
      this.uploadTexture(texture, index);
    }

    this.currentTexture_ = texture;
  }

  public readTexel(texture: Texture, x: number, y: number, z: number): number {
    const gl = this.gl_;
    const textureId = this.textures_.get(texture);
    if (!textureId) {
      throw new Error("readTexel called on a texture that is not resident");
    }

    this.readFramebuffer_ ??= gl.createFramebuffer();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readFramebuffer_);
    gl.framebufferTextureLayer(
      gl.READ_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      textureId,
      0,
      z
    );

    const { format, type, out } = this.readbackParams(texture.dataType);
    gl.readPixels(x, y, 1, 1, format, type, out);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

    return out[0];
  }

  private readbackParams(dataType: TextureDataType): {
    format: number;
    type: number;
    out: Int32Array | Uint32Array | Float32Array;
  } {
    const gl = this.gl_;
    switch (dataType) {
      case "byte":
      case "short":
      case "int":
        return {
          format: gl.RGBA_INTEGER,
          type: gl.INT,
          out: new Int32Array(4),
        };
      case "unsigned_byte":
      case "unsigned_short":
      case "unsigned_int":
        return {
          format: gl.RGBA_INTEGER,
          type: gl.UNSIGNED_INT,
          out: new Uint32Array(4),
        };
      case "float":
      case "half_float":
        return { format: gl.RGBA, type: gl.FLOAT, out: new Float32Array(4) };
    }
  }

  public uploadTexture(texture: Texture, index = 0) {
    if (this.textures_.has(texture) && !texture.needsUpdate) return;

    if (texture.data === null) {
      throw new Error("Cannot upload a texture that has no CPU data");
    }

    const textureType = this.getTextureType(texture);
    const info = this.getDataFormatInfo(texture.dataFormat, texture.dataType);

    this.gl_.activeTexture(this.gl_.TEXTURE0 + index);

    if (!this.textures_.has(texture)) {
      this.generateTexture(texture, info, textureType);
    }

    const textureId = this.textures_.get(texture);
    if (!textureId) {
      throw new Error("Failed to retrieve texture ID");
    }

    this.gl_.bindTexture(textureType, textureId);
    this.configureTextureParameters(texture, textureType);
    this.uploadTextureData(texture, info, textureType);
    this.currentTexture_ = null;

    texture.needsUpdate = false;
  }

  /**
   * Allocates storage for a texture filled on the GPU rather than from CPU
   * data, and returns its handle. Leaves no texture bound.
   */
  public allocate(texture: Texture): WebGLTexture {
    const gl = this.gl_;
    const textureType = this.getTextureType(texture);
    if (!this.textures_.has(texture)) {
      const info = this.getDataFormatInfo(texture.dataFormat, texture.dataType);
      this.generateTexture(texture, info, textureType);
      const id = this.textures_.get(texture)!;
      gl.bindTexture(textureType, id);
      this.configureTextureParameters(texture, textureType);
      if (texture.mipmapLevels > 1 && texture.minFilter === "nearest") {
        gl.texParameteri(
          textureType,
          gl.TEXTURE_MIN_FILTER,
          gl.NEAREST_MIPMAP_NEAREST
        );
      }
      gl.bindTexture(textureType, null);
      this.currentTexture_ = null;
    }
    return this.textures_.get(texture)!;
  }

  public dispose(texture: Texture) {
    const id = this.textures_.get(texture);
    if (id) {
      this.gl_.deleteTexture(id);
      this.textures_.delete(texture);
      texture.readTexel = undefined;
      if (this.currentTexture_ === texture) {
        this.currentTexture_ = null;
      }

      const bytes = textureStorageBytes(texture);
      this.gpuTextureBytes_ = Math.max(0, this.gpuTextureBytes_ - bytes);
      this.textureCount_ = Math.max(0, this.textureCount_ - 1);
    }
  }

  public disposeAll() {
    for (const texture of Array.from(this.textures_.keys())) {
      this.dispose(texture);
    }
    this.gpuTextureBytes_ = 0;
    this.textureCount_ = 0;
  }

  private alreadyActive(texture: Texture) {
    return this.currentTexture_ === texture && !texture.needsUpdate;
  }

  private generateTexture(
    texture: Texture,
    info: TextureFormatInfo,
    type: number
  ) {
    const textureId = this.gl_.createTexture();
    if (!textureId) throw new Error("Failed to create texture");

    this.gl_.bindTexture(type, textureId);

    if (this.isTexture2D(texture)) {
      this.gl_.texStorage2D(
        type,
        texture.mipmapLevels,
        info.internalFormat,
        texture.width,
        texture.height
      );
    } else if (this.isTextureStorage3D(texture)) {
      this.gl_.texStorage3D(
        type,
        texture.mipmapLevels,
        info.internalFormat,
        texture.width,
        texture.height,
        texture.depth
      );
    } else {
      throw new Error(`Unknown texture type ${texture.type}`);
    }

    this.gpuTextureBytes_ += textureStorageBytes(texture);
    this.textureCount_ += 1;
    this.textures_.set(texture, textureId);
    this.gl_.bindTexture(type, null);

    texture.readTexel = (x, y, z) =>
      Promise.resolve(this.readTexel(texture, x, y, z));
  }

  private configureTextureParameters(texture: Texture, type: number) {
    const gl = this.gl_;
    const minFilter = this.getFilter(texture.minFilter, texture);
    const maxFilter = this.getFilter(texture.maxFilter, texture);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, texture.unpackAlignment);
    gl.texParameteri(type, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(type, gl.TEXTURE_MAG_FILTER, maxFilter);
    gl.texParameteri(type, gl.TEXTURE_WRAP_S, this.getWrapMode(texture.wrapS));
    gl.texParameteri(type, gl.TEXTURE_WRAP_T, this.getWrapMode(texture.wrapT));
    gl.texParameteri(type, gl.TEXTURE_WRAP_R, this.getWrapMode(texture.wrapR));
  }

  private uploadTextureData(
    texture: Texture,
    info: TextureFormatInfo,
    type: number
  ) {
    // Only base level (0) is updated; mipmaps are not supported.
    const mipmapLevel = 0;

    // Zero offsets because entire dataset is overwritten.
    const offset = { x: 0, y: 0, z: 0 };

    // WebGL2 requires a Uint16Array for HALF_FLOAT; reinterpret the float16 bits.
    const source = texture.data;
    const data =
      texture.dataType === "half_float" && source
        ? new Uint16Array(source.buffer, source.byteOffset, source.length)
        : source;

    if (this.isTexture2D(texture)) {
      this.gl_.texSubImage2D(
        type,
        mipmapLevel,
        offset.x,
        offset.y,
        texture.width,
        texture.height,
        info.format,
        info.type,
        // This function has multiple overloads. We are temporarily casting it to
        // ArrayBufferView to ensure the correct overload is called. Once we
        // consolidate Texture2D and DataTexture2D, we can remove this cast.
        // https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texSubImage2D#syntax
        data as ArrayBufferView
      );
    } else if (this.isTextureStorage3D(texture)) {
      this.gl_.texSubImage3D(
        type,
        mipmapLevel,
        offset.x,
        offset.y,
        offset.z,
        texture.width,
        texture.height,
        texture.depth,
        info.format,
        info.type,
        data as ArrayBufferView
      );
    } else {
      throw new Error(
        "Attempting to upload data for an unsupported texture type"
      );
    }
  }

  private getFilter(filter: TextureFilter, texture: Texture) {
    const { dataFormat, dataType } = texture;
    if (
      dataFormat === "scalar" &&
      dataType !== "float" &&
      dataType !== "half_float" &&
      filter !== "nearest"
    ) {
      Logger.warn(
        "WebGLTexture",
        "Integer values are not filterable. Using gl.NEAREST instead."
      );
      return this.gl_.NEAREST;
    }
    // prettier-ignore
    switch (filter) {
      case "nearest": return this.gl_.NEAREST;
      case "linear": return this.gl_.LINEAR;
      default: throw new Error(`Unsupported texture filter: ${filter}`);
    }
  }

  private getTextureType(texture: Texture) {
    if (this.isTexture2D(texture)) return this.gl_.TEXTURE_2D;
    if (this.isTexture2DArray(texture)) return this.gl_.TEXTURE_2D_ARRAY;
    if (this.isTexture3D(texture)) return this.gl_.TEXTURE_3D;
    throw new Error(`Unknown texture type ${texture.type}`);
  }

  private getWrapMode(mode: TextureWrapMode) {
    // prettier-ignore
    switch (mode) {
      case "repeat": return this.gl_.REPEAT;
      case "clamp_to_edge": return this.gl_.CLAMP_TO_EDGE;
      default: throw new Error(`Unsupported wrap mode: ${mode}`);
    }
  }

  private getDataFormatInfo(
    format: TextureDataFormat,
    type: TextureDataType
  ): TextureFormatInfo {
    if (format === "rgba" && type === "unsigned_byte") {
      return {
        internalFormat: this.gl_.RGBA8,
        format: this.gl_.RGBA,
        type: this.gl_.UNSIGNED_BYTE,
      };
    }
    if (format === "rgba" && type === "unsigned_int") {
      return {
        internalFormat: this.gl_.RGBA32UI,
        format: this.gl_.RGBA_INTEGER,
        type: this.gl_.UNSIGNED_INT,
      };
    }
    if (format === "rgb" && type === "unsigned_byte") {
      return {
        internalFormat: this.gl_.RGB8,
        format: this.gl_.RGB,
        type: this.gl_.UNSIGNED_BYTE,
      };
    }
    if (format === "scalar") {
      switch (type) {
        case "byte":
          return {
            internalFormat: this.gl_.R8I,
            format: this.gl_.RED_INTEGER,
            type: this.gl_.BYTE,
          };
        case "short":
          return {
            internalFormat: this.gl_.R16I,
            format: this.gl_.RED_INTEGER,
            type: this.gl_.SHORT,
          };
        case "int":
          return {
            internalFormat: this.gl_.R32I,
            format: this.gl_.RED_INTEGER,
            type: this.gl_.INT,
          };
        case "unsigned_byte":
          return {
            internalFormat: this.gl_.R8UI,
            format: this.gl_.RED_INTEGER,
            type: this.gl_.UNSIGNED_BYTE,
          };
        case "unsigned_short":
          return {
            internalFormat: this.gl_.R16UI,
            format: this.gl_.RED_INTEGER,
            type: this.gl_.UNSIGNED_SHORT,
          };
        case "unsigned_int":
          return {
            internalFormat: this.gl_.R32UI,
            format: this.gl_.RED_INTEGER,
            type: this.gl_.UNSIGNED_INT,
          };
        case "float":
          return {
            internalFormat: this.gl_.R32F,
            format: this.gl_.RED,
            type: this.gl_.FLOAT,
          };
        case "half_float":
          return {
            internalFormat: this.gl_.R16F,
            format: this.gl_.RED,
            type: this.gl_.HALF_FLOAT,
          };
        default:
          throw new Error(`Unsupported scalar type: ${type}`);
      }
    }
    throw new Error(`Unsupported format/type: ${format}/${type}`);
  }

  private isTextureStorage3D(
    texture: Texture
  ): texture is Texture2DArray | Texture3D {
    return this.isTexture2DArray(texture) || this.isTexture3D(texture);
  }

  private isTexture2D(texture: Texture): texture is Texture2D {
    return texture.type === "Texture2D";
  }

  private isTexture2DArray(texture: Texture): texture is Texture2DArray {
    return texture.type === "Texture2DArray";
  }

  private isTexture3D(texture: Texture): texture is Texture3D {
    return texture.type === "Texture3D";
  }
}
