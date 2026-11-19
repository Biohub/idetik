import { RenderableObject } from "../../core/renderable_object";
import { PlaneGeometry } from "../../objects/geometry/plane_geometry";
import { mat4 } from "gl-matrix";
import { Texture, TextureDataType } from "../../objects/textures/texture";
import { Color, ColorLike } from "../../math/color";
import { Texture2D } from "../textures/texture_2d";
import { Shader } from "../../renderers/shaders";

const defaultColorCycle: ColorLike[] = [
  [1.0, 0.5, 0.5],
  [0.5, 1.0, 0.5],
  [0.5, 0.5, 1.0],
  [0.5, 1.0, 1.0],
  [1.0, 0.5, 1.0],
  [1.0, 1.0, 0.5],
];

function validateLookupTable(
  lookupTable?: ReadonlyMap<number, ColorLike>
): ReadonlyMap<number, Color> {
  lookupTable = lookupTable ?? new Map();
  return new Map(
    Array.from(lookupTable.entries()).map(([key, value]) => [
      key,
      Color.from(value),
    ])
  );
}

function validateCycle(cycle?: ReadonlyArray<ColorLike>): ReadonlyArray<Color> {
  cycle = cycle ?? defaultColorCycle;
  return cycle.map(Color.from);
}

/**
 * Color assignments for label values.
 *
 * Values present in `lookupTable` use its color. Any other value takes a
 * color from `cycle` by index. Value `0` renders transparent unless the
 * lookup table assigns it a color.
 */
export type LabelColorMapProps = {
  /** Exact colors for specific label values. */
  lookupTable?: ReadonlyMap<number, ColorLike>;
  /** Colors cycled by value. Defaults to 6 built-ins. */
  cycle?: ReadonlyArray<ColorLike>;
};

/**
 * A validated color map with every entry resolved to a {@link Color}.
 * Returned by {@link LabelLayer.colorMap}.
 */
export type LabelColorMap = {
  /** Exact colors for specific label values. */
  readonly lookupTable: ReadonlyMap<number, Color>;
  /** Colors cycled by value. */
  readonly cycle: ReadonlyArray<Color>;
};

export function validateColorMap(
  props: LabelColorMapProps = {}
): LabelColorMap {
  return {
    lookupTable: validateLookupTable(props.lookupTable),
    cycle: validateCycle(props.cycle),
  };
}

/**
 * Initialization properties for constructing a label image renderable.
 */
export type LabelImageRenderableProps = {
  /** Width of the label image in texels. */
  width: number;
  /** Height of the label image in texels. */
  height: number;
  /** Scalar integer texture of label values. */
  imageData: Texture;
  /** Colors to apply to label values. */
  colorMap: LabelColorMapProps;
  /** Outlines the selected value. Defaults to `false`. */
  outlineSelected?: boolean;
  /** The selected label value. Defaults to `null`. */
  selectedValue?: number | null;
};

const signedDataTypes = new Set<TextureDataType>(["byte", "short", "int"]);
const unsignedDataTypes = new Set<TextureDataType>([
  "unsigned_byte",
  "unsigned_short",
  "unsigned_int",
]);

function validateImageData(imageData: Texture) {
  if (imageData.dataFormat !== "scalar") {
    throw new Error(
      `Image data format must be scalar, instead found: ${imageData.dataFormat}`
    );
  }
  if (
    !signedDataTypes.has(imageData.dataType) &&
    !unsignedDataTypes.has(imageData.dataType)
  ) {
    throw new Error(
      `Image data type must be an integer, instead found: ${imageData.dataType}`
    );
  }
  return imageData;
}

function labelTextureToShader(texture: Texture): Shader {
  return signedDataTypes.has(texture.dataType) ? "intLabelImage" : "labelImage";
}

/**
 * A textured plane that draws one 2D slice of integer label data.
 *
 * Each label value is colored through a {@link LabelColorMap}. Values in
 * the lookup table use its color, other values take a color from the
 * cycle, and value `0` renders transparent unless the lookup table covers
 * it. The image texture must hold scalar integer data. {@link LabelLayer}
 * constructs and pools one instance per visible chunk, so most
 * applications configure labels through the layer instead.
 *
 * @group Renderables
 */
export class LabelImageRenderable extends RenderableObject {
  /**
   * A matrix mapping world space to the texture's normalized coordinate
   * space. Layers derive it from the chunk's offset, scale, and shape.
   */
  public worldToTexCoord: mat4 = mat4.create();

  private outlineSelected_: boolean;
  private selectedValue_: number | null;

  /**
   * Creates a label renderable drawing the given label texture. The
   * texture's data type selects the matching label shader.
   *
   * @param props - Initialization properties.
   */
  constructor(props: LabelImageRenderableProps) {
    super();
    this.geometry = new PlaneGeometry(props.width, props.height, 1, 1);
    this.setTexture(0, validateImageData(props.imageData));
    const colorMap = validateColorMap(props.colorMap);
    this.setTexture(1, this.makeColorCycleTexture(colorMap.cycle));
    this.setTexture(2, this.makeColorLookupTableTexture(colorMap.lookupTable));
    this.outlineSelected_ = props.outlineSelected ?? false;
    this.selectedValue_ = props.selectedValue ?? null;
    this.programName = labelTextureToShader(props.imageData);
    this.depthProgramName = "meshDepth";
  }

  /** Identifies the renderable type as `LabelImageRenderable`. */
  public get type() {
    return "LabelImageRenderable";
  }

  /**
   * Returns the sampler, color map, and selection uniforms for the label
   * image shaders.
   */
  public getUniforms() {
    return {
      u_imageSampler: 0,
      u_colorCycleSampler: 1,
      u_colorLookupTableSampler: 2,
      u_outlineSelected: this.outlineSelected_ ? 1.0 : 0.0,
      u_selectedValue: this.selectedValue_ ?? -1.0,
      u_worldToTexCoord: this.worldToTexCoord,
    };
  }

  /**
   * Replaces the label color map. The previous color map textures are
   * marked stale for GPU disposal.
   *
   * @param colorMap - The new color map.
   */
  public setColorMap(colorMap: LabelColorMapProps) {
    const validated = validateColorMap(colorMap);
    this.markStaleTexture(this.textures[1]);
    this.markStaleTexture(this.textures[2]);
    this.setTexture(1, this.makeColorCycleTexture(validated.cycle));
    this.setTexture(2, this.makeColorLookupTableTexture(validated.lookupTable));
  }

  /**
   * Sets the label value drawn as selected or `null` to clear the
   * selection. The selected region is outlined when the renderable was
   * constructed with `outlineSelected`.
   *
   * @param value - The label value to select.
   */
  public setSelectedValue(value: number | null) {
    this.selectedValue_ = value;
  }

  private makeColorCycleTexture(cycle: ReadonlyArray<Color>) {
    const data = new Uint8Array(
      cycle.flatMap((c) => c.rgba).map((v) => Math.round(v * 255))
    );
    const texture = new Texture2D(data, cycle.length, 1);
    texture.dataFormat = "rgba";
    return texture;
  }

  private makeColorLookupTableTexture(
    lookupTable?: ReadonlyMap<number, Color>
  ) {
    if (lookupTable === undefined) {
      lookupTable = new Map([[0, Color.TRANSPARENT]]);
    } else if (!lookupTable.has(0)) {
      lookupTable = new Map([[0, Color.TRANSPARENT], ...lookupTable]);
    }
    const keys = Array.from(lookupTable.keys());
    const values = Array.from(lookupTable.values()).map((c) => c.packed);
    const numColors = lookupTable.size;
    const data = new Uint32Array(numColors * 2);
    data.set(keys, 0);
    data.set(values, numColors);
    return new Texture2D(data, numColors, 2);
  }
}
