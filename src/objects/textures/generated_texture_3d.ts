import type { Shader } from "../../renderers/shaders";
import { Texture, TextureDataFormat, TextureDataType } from "./texture";

/**
 * One GPU pass that fills a mip level of a {@link GeneratedTexture3D}.
 *
 * The program runs over a fullscreen triangle once per z-slice of the
 * level, with `u_slice` and `u_level` set. Inputs are bound to units
 * `0, 1, ...` as `u_input0`, `u_input1`, .... Passes above level 0 can
 * also read the level below through `u_previousLevel`.
 */
export type TextureGenerationPass = {
  programName: Shader;
  inputs: ReadonlyArray<Texture>;
  uniforms?: Readonly<Record<string, unknown>>;
};

/**
 * A 3D texture computed on the GPU from other textures instead of
 * uploaded from CPU data. The renderer runs its passes, one per mip
 * level, before the first frame that draws it.
 */
export class GeneratedTexture3D extends Texture {
  public readonly passes: ReadonlyArray<TextureGenerationPass>;
  /**
   * Whether the texture is only an input to other generated textures. The
   * renderer frees it once a texture reading it is generated, and
   * generates it again if another one needs it.
   */
  public transient = false;
  private readonly width_: number;
  private readonly height_: number;
  private readonly depth_: number;

  constructor(
    width: number,
    height: number,
    depth: number,
    format: { dataFormat: TextureDataFormat; dataType: TextureDataType },
    passes: ReadonlyArray<TextureGenerationPass>
  ) {
    super();
    this.width_ = width;
    this.height_ = height;
    this.depth_ = depth;
    this.dataFormat = format.dataFormat;
    this.dataType = format.dataType;
    this.mipmapLevels = passes.length;
    this.passes = passes;
  }

  public get type() {
    return "Texture3D";
  }

  public get width() {
    return this.width_;
  }

  public get height() {
    return this.height_;
  }

  public get depth() {
    return this.depth_;
  }
}
