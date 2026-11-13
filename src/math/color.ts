import { vec3, vec4 } from "gl-matrix";

/**
 * An sRGB color convertible to {@link Color}. Array alpha is linear opacity.
 */
export type ColorLike = Color | vec3 | vec4 | string;

/**
 * Immutable sRGB color with components in `[0, 1]` and linear alpha.
 *
 * Color represents an RGBA value with four components. It is used for channel
 * tints, label color maps, and wireframe overlays. Components are validated
 * at construction and never change. Every API that takes a color accepts a
 * {@link ColorLike} so hex strings and component arrays coerce automatically
 * through {@link from}. Common colors are available as static presets.
 * RGB components, hex strings, and packed bytes use the sRGB encoding.
 * Use {@link linearRgb} or {@link linearRgba} for rendering calculations.
 *
 * @group Math
 */
export class Color {
  /** Opaque red `#ff0000`. */
  public static readonly RED: Color = new Color(1.0, 0.0, 0.0);
  /** Opaque green `#00ff00`. */
  public static readonly GREEN: Color = new Color(0.0, 1.0, 0.0);
  /** Opaque blue `#0000ff`. */
  public static readonly BLUE: Color = new Color(0.0, 0.0, 1.0);
  /** Opaque yellow `#ffff00`. */
  public static readonly YELLOW: Color = new Color(1.0, 1.0, 0.0);
  /** Opaque magenta `#ff00ff`. */
  public static readonly MAGENTA: Color = new Color(1.0, 0.0, 1.0);
  /** Opaque cyan `#00ffff`. */
  public static readonly CYAN: Color = new Color(0.0, 1.0, 1.0);
  /** Opaque black `#000000`. */
  public static readonly BLACK: Color = new Color(0.0, 0.0, 0.0);
  /** Opaque white `#ffffff`. */
  public static readonly WHITE: Color = new Color(1.0, 1.0, 1.0);
  /** Fully transparent black. */
  public static readonly TRANSPARENT: Color = new Color(0.0, 0.0, 0.0, 0.0);

  // sRGB components and linear alpha in the range [0, 1].
  private readonly rgba_: readonly [number, number, number, number];
  private linearRgb_?: readonly [number, number, number];
  private linearRgba_?: readonly [number, number, number, number];

  /**
   * Creates a color from sRGB components and linear alpha in `[0, 1]`.
   *
   * @param r - The red component.
   * @param g - The green component.
   * @param b - The blue component.
   * @param a - The alpha component. Defaults to `1`.
   */
  constructor(r: number, g: number, b: number, a?: number) {
    if (r < 0 || r > 1 || g < 0 || g > 1 || b < 0 || b > 1) {
      throw new Error("RGB values must be in the range [0, 1]");
    }
    if (a !== undefined && (a < 0 || a > 1)) {
      throw new Error("Alpha value must be in the range [0, 1]");
    }
    this.rgba_ = [r, g, b, a ?? 1.0];
  }

  /** The sRGB components as a three-element array. */
  public get rgb(): [number, number, number] {
    return [this.rgba_[0], this.rgba_[1], this.rgba_[2]];
  }

  /** The sRGB components and linear alpha as a four-element array. */
  public get rgba(): readonly [number, number, number, number] {
    return this.rgba_;
  }

  /** The cached RGB components decoded to linear sRGB for rendering calculations. */
  public get linearRgb(): readonly [number, number, number] {
    this.linearRgb_ ??= Object.freeze([
      srgbToLinear(this.r),
      srgbToLinear(this.g),
      srgbToLinear(this.b),
    ] as const);
    return this.linearRgb_;
  }

  /** The cached linear sRGB components with the original, unchanged alpha. */
  public get linearRgba(): readonly [number, number, number, number] {
    this.linearRgba_ ??= Object.freeze([...this.linearRgb, this.a] as const);
    return this.linearRgba_;
  }

  /** The sRGB red component. */
  public get r(): number {
    return this.rgba_[0];
  }

  /** The sRGB green component. */
  public get g(): number {
    return this.rgba_[1];
  }

  /** The sRGB blue component. */
  public get b(): number {
    return this.rgba_[2];
  }

  /** The alpha component. */
  public get a(): number {
    return this.rgba_[3];
  }

  /** The sRGB color as a `#rrggbb` hex string. Alpha is dropped. */
  public get rgbHex(): string {
    return `#${this.toHexComponent(this.r)}${this.toHexComponent(this.g)}${this.toHexComponent(this.b)}`;
  }

  /** The sRGB color and linear alpha packed into 32 bits as RGBA bytes. */
  public get packed(): number {
    return (
      (Math.round(this.r * 255) << 24) |
      (Math.round(this.g * 255) << 16) |
      (Math.round(this.b * 255) << 8) |
      Math.round(this.a * 255)
    );
  }

  /**
   * Converts a {@link ColorLike} value to a `Color`.
   *
   * @param colorLike - The value to convert.
   */
  public static from(colorLike: ColorLike): Color {
    if (colorLike instanceof Color) {
      return colorLike;
    }

    if (Array.isArray(colorLike)) {
      return new Color(colorLike[0], colorLike[1], colorLike[2], colorLike[3]);
    }

    if (typeof colorLike === "string") {
      return Color.fromRgbHex(colorLike);
    }

    throw new Error("Unsupported color format");
  }

  /**
   * Parses an sRGB `#rrggbb` hex string into an opaque color.
   *
   * @param hex - The hex string with or without the leading `#`.
   */
  public static fromRgbHex(hex: string): Color {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
      throw new Error("Invalid RGB hex, use form '#RRGGBB'");
    }
    return new Color(
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255,
      1.0
    );
  }

  private toHexComponent(value: number): string {
    const hex = Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
    return hex.length === 1 ? "0" + hex : hex;
  }
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
