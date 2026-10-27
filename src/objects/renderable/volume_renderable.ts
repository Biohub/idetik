import type { Shader } from "../../renderers/shaders";
import { RenderableObject } from "../../core/renderable_object";
import { BoxGeometry } from "../geometry/box_geometry";
import { type Texture, TextureDataType } from "../textures/texture";
import {
  Channel,
  ChannelProps,
  validateChannel,
  validateChannels,
} from "../../core/channel";
import { vec3 } from "gl-matrix";
import type { Chunk } from "../../data/chunk";

/**
 * Initialization properties for constructing a volume renderable.
 */
export type VolumeRenderableProps = {
  /** Channel appearance settings. Defaults to `[]`. */
  channelProps?: ChannelProps[];
};

/**
 * A ray-marched box that draws multi-channel volumetric data.
 *
 * The renderable draws a unit box and ray marches through 3D chunk
 * textures in the fragment shader. Up to 4 channels blend in a single
 * pass and all loaded channels must share one texture data type. Front
 * faces are culled and depth testing is off by default.
 * {@link VolumeLayer} constructs and pools one instance per spatial chunk
 * group, streams chunk textures in with {@link updateVolumeWithChunk},
 * and sizes the box through the transform.
 *
 * @group Renderables
 */
export class VolumeRenderable extends RenderableObject {
  /**
   * World size of a voxel along each axis. Layers set it from the chunk
   * scale so ray march steps account for anisotropic voxels. Defaults to
   * `[1, 1, 1]`.
   */
  public voxelScale: vec3 = vec3.fromValues(1, 1, 1);

  private channels_: Required<Channel>[];
  private loadedChannels_: Set<number> = new Set();

  private readonly channelToTextureIndex_: Map<number, number> = new Map();

  /**
   * Creates an empty volume renderable.
   *
   * @param props - Initialization properties.
   */
  constructor({ channelProps = [] }: VolumeRenderableProps = {}) {
    super();
    this.geometry = new BoxGeometry(1, 1, 1, 1, 1, 1);
    this.cullFaceMode = "front";
    this.depthTest = false;
    this.channels_ = [];
    this.setChannelProps(channelProps);
  }

  /** Identifies the renderable type as `VolumeRenderable`. */
  public get type() {
    return "VolumeRenderable";
  }

  /**
   * Loads or refreshes the texture for the chunk's channel. The channel
   * index comes from the chunk and the texture's data type selects the
   * volume shader, so every channel must share one data type. Chunks
   * without a texture are ignored.
   *
   * @param chunk - The chunk holding the channel texture.
   */
  public updateVolumeWithChunk(chunk: Chunk): void {
    if (!chunk.texture) return;

    const channelIndex = chunk.chunkIndex.c;

    const textureIndex = this.channelToTextureIndex_.get(channelIndex);
    if (textureIndex !== undefined) {
      this.updateChannelTexture(textureIndex, chunk.texture);
    } else {
      this.addChannelTexture(channelIndex, chunk.texture);
    }

    this.loadedChannels_.add(channelIndex);
  }

  private addChannelTexture(channelIndex: number, texture: Texture): void {
    const textureIndex = this.textures.length;

    this.setTexture(textureIndex, texture);
    this.channelToTextureIndex_.set(channelIndex, textureIndex);

    const newProgramName = dataTypeToVolumeShader(texture.dataType);
    if (this.programName && this.programName !== newProgramName) {
      throw new Error(
        `Volume renderable does not support multiple channels with different data types. Existing program: ${this.programName}, new channel data type: ${texture.dataType} and program: ${newProgramName}`
      );
    }

    this.programName = newProgramName;
  }

  private updateChannelTexture(textureIndex: number, texture: Texture): void {
    this.setTexture(textureIndex, texture);
  }

  /**
   * Marks all channels as not loaded so they stop rendering until the
   * next chunk update. The textures themselves are kept.
   */
  public clearLoadedChannels() {
    this.loadedChannels_ = new Set();
  }

  /**
   * Clears all textures and channel state so the renderable can be
   * pooled and reused for another chunk.
   */
  public reset() {
    this.clearTextures();
    this.channelToTextureIndex_.clear();
    this.clearLoadedChannels();
  }

  /**
   * Returns per-channel sampler, color, contrast, opacity, and
   * visibility uniforms for up to 4 loaded channels plus the voxel
   * scale.
   */
  public override getUniforms(): Record<string, number[] | number> {
    const loadedAndVisibleTextures = [0, 0, 0, 0];
    // prettier-ignore
    const colors = [
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
    ]
    const valueOffset = [0, 0, 0, 0];
    const valueScale = [1, 1, 1, 1];
    const channelOpacity = [1, 1, 1, 1];
    const samplerUniforms: number[] = [];

    // Allow to render without channel props specified
    const numTotalChannels = Math.max(
      this.channels_.length,
      this.channelToTextureIndex_.size
    );

    for (let i = 0; i < numTotalChannels && samplerUniforms.length < 4; i++) {
      const textureIndex = this.channelToTextureIndex_.get(i);
      if (textureIndex === undefined || !this.loadedChannels_.has(i)) continue;

      const texture = this.textures[textureIndex];
      const channel = validateChannel(texture, this.channels_[i] || {});
      if (!channel.visible) continue;

      const k = samplerUniforms.length;
      colors[k * 3] = channel.color.rgb[0];
      colors[k * 3 + 1] = channel.color.rgb[1];
      colors[k * 3 + 2] = channel.color.rgb[2];

      samplerUniforms.push(textureIndex);
      valueOffset[k] = -channel.contrastLimits[0];
      valueScale[k] =
        1 / (channel.contrastLimits[1] - channel.contrastLimits[0]);
      loadedAndVisibleTextures[k] = 1;

      channelOpacity[k] = channel.opacity;
    }

    return samplerUniforms.reduce<Record<string, number[] | number>>(
      (uniforms, textureIndex, i) => {
        uniforms[`u_channel${i}Sampler`] = textureIndex;
        return uniforms;
      },
      {
        u_visible: loadedAndVisibleTextures,
        "u_color[0]": colors,
        u_valueOffset: valueOffset,
        u_valueScale: valueScale,
        u_channelOpacity: channelOpacity,
        u_voxelScale: [
          this.voxelScale[0],
          this.voxelScale[1],
          this.voxelScale[2],
        ],
      }
    );
  }

  /**
   * Get an available texture for a channel. If desiredChannelIndex is provided, it will try to return the texture for that channel index. If that texture is not available, or no desiredChannelIndex is passed, return the first available channel texture. This is used to determine which texture to use when updating channel properties, since channel properties can be updated even if the channel's texture hasn't been loaded yet. If no textures are available, it returns null, which signals that default contrast limits should be used when validating the channel properties.
   */
  private getAvailableChannelTexture(
    desiredChannelIndex?: number
  ): Texture | null {
    if (desiredChannelIndex !== undefined) {
      const textureIndex = this.channelToTextureIndex_.get(desiredChannelIndex);
      if (textureIndex !== undefined) return this.textures[textureIndex];
    }

    const firstTextureIndex = this.channelToTextureIndex_.values().next().value;
    return firstTextureIndex !== undefined
      ? this.textures[firstTextureIndex]
      : null;
  }

  /**
   * Replaces the appearance settings for all channels.
   *
   * @param channels - The new channel settings.
   */
  public setChannelProps(channels: ChannelProps[]) {
    this.channels_ = validateChannels(
      this.getAvailableChannelTexture(),
      channels
    );
  }

  /**
   * Updates one property of the channel at the given index and
   * revalidates it against the channel's texture when available.
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
    const newChannel = validateChannel(
      this.getAvailableChannelTexture(channelIndex),
      {
        ...this.channels_[channelIndex],
        [property]: value,
      }
    );

    this.channels_[channelIndex] = newChannel;
  }
}

function dataTypeToVolumeShader(dataType: TextureDataType): Shader {
  switch (dataType) {
    case "byte":
    case "int":
    case "short":
      return "intVolume";
    case "unsigned_short":
    case "unsigned_byte":
    case "unsigned_int":
      return "uintVolume";
    case "float":
    case "half_float":
      return "floatVolume";
  }
}
