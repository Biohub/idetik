import { RenderableObject } from "../../core/renderable_object";
import { PlaneGeometry } from "../../objects/geometry/plane_geometry";
import { Texture } from "../../objects/textures/texture";
import {
  Channel,
  ChannelProps,
  validateChannel,
  validateChannels,
} from "../../core/channel";
import { mat4, vec3 } from "gl-matrix";
import { Shader } from "../../renderers/shaders";

/**
 * Initialization properties for constructing an image renderable.
 */
export type ImageRenderableProps = {
  /** Width of the image in texels. */
  width: number;
  /** Height of the image in texels. */
  height: number;
  /** The scalar image texture to draw. */
  texture: Texture;
  /** Channel appearance settings. Defaults to `[]`. */
  channelProps?: ChannelProps[];
};

type UniformValues = {
  u_color: vec3;
  u_imageSampler: number;
  Opacity: number;
  u_valueOffset: number;
  u_valueScale: number;
  u_worldToTexCoord: mat4;
};

/**
 * A textured plane that draws one 2D slice of scalar image data.
 *
 * Image renderable maps a scalar texture through a single channel's
 * color, contrast limits, and opacity. {@link ImageLayer} constructs and
 * pools one instance per visible chunk, so most applications never create
 * these directly.
 *
 * @group Renderables
 */
export class ImageRenderable extends RenderableObject {
  /**
   * A matrix mapping world space to the texture's normalized coordinate
   * space. Layers derive it from the chunk's offset, scale, and shape.
   */
  public worldToTexCoord: mat4 = mat4.create();

  private channels_: Required<Channel>[];

  /**
   * Creates an image renderable drawing the given texture. The texture's
   * data type selects the matching scalar image shader.
   *
   * @param props - Initialization properties.
   */
  constructor({
    width,
    height,
    texture,
    channelProps = [],
  }: ImageRenderableProps) {
    super();
    this.geometry = new PlaneGeometry(width, height, 1, 1);
    this.setTexture(0, texture);
    this.channels_ = validateChannels(texture, channelProps);
    this.programName = textureToShader(texture);
    this.depthProgramName = "meshDepth";
  }

  /** Identifies the renderable type as `ImageRenderable`. */
  public get type() {
    return "ImageRenderable";
  }

  /**
   * Replaces the channel appearance settings and revalidates them
   * against the current texture. Only the first entry affects rendering.
   *
   * @param channels - The new channel settings.
   */
  public setChannelProps(channels: ChannelProps[]) {
    this.channels_ = validateChannels(this.textures[0], channels);
  }

  /**
   * Updates one property of the channel at the given index and
   * revalidates the channel against the current texture.
   *
   * @param channelIndex - The channel to update.
   * @param property - The property name to set.
   * @param value - The new value.
   */
  public setChannelProperty<K extends keyof ChannelProps>(
    channelIndex: number,
    property: K,
    value: Required<ChannelProps>[K]
  ) {
    const newChannel = validateChannel(this.textures[0], {
      ...this.channels_[channelIndex],
      [property]: value,
    });

    this.channels_[channelIndex] = newChannel;
  }

  /**
   * Returns the sampler, contrast, color, opacity, and world-to-texture
   * uniforms for the scalar image shaders.
   */
  public override getUniforms(): UniformValues {
    const texture = this.textures[0];
    if (!texture) {
      throw new Error("No texture set");
    }

    const { color, contrastLimits, opacity } =
      this.channels_[0] ?? validateChannel(texture, {});

    return {
      u_imageSampler: 0,
      u_color: color.rgb,
      u_valueOffset: -contrastLimits[0],
      u_valueScale: 1 / (contrastLimits[1] - contrastLimits[0]),
      Opacity: opacity,
      u_worldToTexCoord: this.worldToTexCoord,
    };
  }
}

function textureToShader(texture: Texture): Shader {
  switch (texture.dataType) {
    case "byte":
    case "int":
    case "short":
      return "intScalarImage";
    case "unsigned_short":
    case "unsigned_byte":
    case "unsigned_int":
      return "uintScalarImage";
    case "float":
    case "half_float":
      return "floatScalarImage";
  }
}
