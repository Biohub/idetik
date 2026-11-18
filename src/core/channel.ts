import { Color, ColorLike } from "../math/color";
import { Texture, textureDefaultValueRange } from "../objects/textures/texture";
import { Logger } from "../utilities/logger";
import { clamp } from "../utilities/clamp";

const MAX_CHANNELS = 32;

export type Channel = {
  visible: boolean;
  color: Color;
  colorMap: ChannelProps["colorMap"];
  contrastLimits: [number, number];
  opacity: number;
};

/**
 * Appearance settings for a single image channel.
 */
export type ChannelProps = {
  /** Whether the channel is drawn. Defaults to `true`. */
  visible?: boolean;
  /** The channel's tint color. Defaults to white. */
  color?: ColorLike;
  /** The channel's colormap, used instead of `color`. Defaults to none. */
  colorMap?: "viridis" | "magma" | "inferno" | "plasma" | "cividis" | "turbo";
  /** Intensity range shown. Defaults to the data range. */
  contrastLimits?: [number, number];
  /** Channel opacity in `[0, 1]`. Defaults to `1`. */
  opacity?: number;
};

/** Layer that exposes channel controls. */
export interface ChannelsEnabled {
  channelProps: ChannelProps[] | undefined;
  setChannelProps(channelProps: ChannelProps[]): void;
  resetChannelProps(): void;
  addChannelChangeCallback(callback: () => void): void;
  removeChannelChangeCallback(callback: () => void): void;
}

export function validateChannel(
  texture: Texture | null,
  { visible, color, colorMap, contrastLimits, opacity }: ChannelProps
): Channel {
  visible ??= true;
  color = color === undefined ? Color.WHITE : Color.from(color);
  opacity = opacity === undefined ? 1 : clamp(opacity, 0, 1);

  if (
    colorMap !== undefined &&
    !Object.keys(COLOR_MAP_HEX).includes(colorMap)
  ) {
    throw new Error(`Unknown color map: ${colorMap}.`);
  }

  if (texture !== null) {
    contrastLimits = validateContrastLimits(contrastLimits, texture);
  } else if (contrastLimits === undefined) {
    Logger.debug(
      "Channel",
      "No texture provided, defaulting channel contrast limits to [0, 1]."
    );
    contrastLimits = [0, 1];
  }

  return {
    visible,
    color,
    colorMap,
    contrastLimits,
    opacity,
  };
}

export function validateChannels(
  texture: Texture | null,
  channelProps: ChannelProps[]
): Channel[] {
  if (channelProps.length > MAX_CHANNELS) {
    throw new Error(`Maximum number of channels is ${MAX_CHANNELS}`);
  }

  return channelProps.map((props) => validateChannel(texture, props));
}

export function validateChannelPropsCount(
  channelProps: ChannelProps[] | undefined,
  sourceChannelCount: number
): void {
  if (channelProps && channelProps.length !== sourceChannelCount) {
    throw new Error(
      `channelProps length (${channelProps.length}) must match ` +
        `source channel count (${sourceChannelCount}).`
    );
  }
}

function validateContrastLimits(
  contrastLimits: [number, number] | undefined,
  texture: Texture
): [number, number] {
  if (contrastLimits === undefined) {
    return textureDefaultValueRange(texture);
  }
  if (contrastLimits[1] <= contrastLimits[0]) {
    throw new Error(
      `Contrast limits must be strictly increasing: ${contrastLimits}.`
    );
  }
  return contrastLimits;
}

// 48 evenly spaced colors from each of matplotlib's 256-entry tables:
// https://github.com/matplotlib/matplotlib/blob/main/lib/matplotlib/_cm_listed.py
const COLOR_MAP_HEX: Record<NonNullable<ChannelProps["colorMap"]>, string> = {
  viridis:
    "44015446085c47116448186a482071482677472e7c463480443a834241863f47883d4e8a" +
    "3a538b375a8c355f8d32648e306a8e2e6f8e2b748e29798e277f8e25838e23888e218e8d" +
    "20928c1f988b1e9d891fa18722a78525ac822cb17e32b67a3bbb7544bf704ec36b5ac864" +
    "65cb5e73d0567fd34e8ed6459bd93ca8db34b8de29c5e021d5e21ae2e418f1e51dfde725",
  magma:
    "00000402020b0605180a0822110c2f160f3b1e11492512552d116138106c400f744a1079" +
    "52137c5c167f641a806b1d817521817c23828627818e2a81982d80a02f7fa8327db2357b" +
    "ba3878c43c75cc3f71d3436edc4869e34e65ea5661ef5d5ef4675cf7705cf9795dfb8560" +
    "fc8e64fd9a6afea36ffeae77feb77efec185fecc8ffed597fde0a1fde9aafcf4b6fcfdbf",
  inferno:
    "00000402020c0604190b0724120a32190c3e230c4c2b0b57340a5f3e0966470b6a510e6c" +
    "59106e62146e6a176e721a6e7c1d6d84206b8d23699526679f2a63a62d60ae305cb73557" +
    "bf3952c73e4cce4347d44842db503be15635e75e2eeb6628f06f20f37819f68013f98b0b" +
    "fa9407fc9f07fca80dfcb418fbbe23f9c72ff7d340f4dd4ff2e865f1f179f5f992fcffa4",
  plasma:
    "0d08871b068d2805923105973c049b44039e4e02a25601a45e01a66700a86f00a87801a8" +
    "8004a88808a68f0da49613a19e199da51f99ac2694b22b8fb83289be3885c33d80c9447a" +
    "cd4a76d35171d7566cdb5c68e06363e4695ee87059eb7655ef7e50f2844bf58b47f79342" +
    "f99a3efba238fca934fdb22ffeba2cfdc229fdcb26fbd324f9dd25f6e626f3f027f0f921",
  cividis:
    "00224e002656002a61002e6a0031710f35701c396f243c6e2b406d33446d39486c3f4c6c" +
    "444f6c4a536c4f576c545a6d595e6e5e626e636670676a716c6e727172747575757a7a78" +
    "7e7d788482798985788e8978938e789892779e9676a39a74a99f73aea371b4a76fbaac6d" +
    "bfb06bc5b568cbb965d1bf61d6c35ddcc859e2cd54e8d24fefd748f5dc41fce236fee838",
  turbo:
    "30123b36215f3c32864040a24451bf455ed3476ee6477bf24687fb4196ff3aa3fc2fb2f4" +
    "27bee91ecbda19d5cd18dec01de7b227eea438f4914af88061fc6c75fe5c88ff4e9cfe40" +
    "a9fb39b9f635c6f034d2e935dfdf37e9d539f2c93af8be39fcb136fea431fe962bfc8423" +
    "f9751df36315ed5510e5470bdd3d08d43305c82803bc2002ac17019e10018b09027a0403",
};

export const COLOR_MAPS = Object.fromEntries(
  Object.entries(COLOR_MAP_HEX).map(([name, hex]) => [
    name,
    hex.match(/.{6}/g)!.flatMap((color) => Color.fromRgbHex(color).rgb),
  ])
);
