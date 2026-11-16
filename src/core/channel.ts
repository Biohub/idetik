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

// 32 evenly spaced colors from each of matplotlib's 256-entry tables:
// https://github.com/matplotlib/matplotlib/blob/main/lib/matplotlib/_cm_listed.py
const COLOR_MAP_HEX: Record<NonNullable<ChannelProps["colorMap"]>, string> = {
  viridis:
    "440154470d6048186a482475472e7c4538824241863e4c8a3a548c365d8d3265" +
    "8e2e6d8e2b758e287d8e25848e228c8d1f948c1e9c8920a38625ab822eb37c3a" +
    "ba7648c16e58c76569cd5b7fd34e93d741a8db34bddf26d5e21aeae51afde725",
  magma:
    "0000040303120a0822140e361e11492a115c38106c47107854137d6018806d1d" +
    "81792282882781942c80a1307eae347bbd3977ca3e72d6456ce24d66ec5860f3" +
    "655cf8745cfb835ffd9266fea36ffeb27afec185fecf92fde0a1fceeb0fcfdbf",
  inferno:
    "0000040403120b0724160b39230c4c310a5c3e09664d0d6c5a116e67166e741a" +
    "6e801f6c8f24699b2964a82e5fb43359c13a50cc4248d74b3fe05536e9612bef" +
    "6e21f57b17f8890cfb9706fca80dfbb81df9c72ff6d746f2e865f3f586fcffa4",
  plasma:
    "0d088722069031059741049d4e02a25b01a56700a87501a88104a78d0ba59814" +
    "a0a21d9aad2793b6308bbf3984c7427ccf4c74d6556ddd5e66e3685fe97257ef" +
    "7c51f3874af79143fa9c3cfca934fdb52efdc229fcce25f9dd25f5eb27f0f921",
  cividis:
    "00224e00285b002e6a0833701c396f293f6e33446d3d4a6c45506c4d556c555b" +
    "6d5c616e6467706b6d72727274787877807f78888578908b78979177a09875a8" +
    "9e73b0a571b9ab6dc1b26acbb965d3c05fdcc859e5cf52efd748f8df3cfee838",
  turbo:
    "30123b392a734040a24559cb476ee64682f84196ff33adf725c0e71ad2d218e0" +
    "bd22ebaa3cf58e59fb7379fe5996fe44affa37c3f134d7e535e7d739f5c53afc" +
    "b336fe9e2ffc8725f76f1aed5510e2430ad43305c32503ac1701950d017a0403",
};

export const COLOR_MAPS = Object.fromEntries(
  Object.entries(COLOR_MAP_HEX).map(([name, hex]) => [
    name,
    hex.match(/.{6}/g)!.flatMap((color) => Color.fromRgbHex(color).rgb),
  ])
);
