import {
  Idetik,
  ColorLike,
  Layer,
  PanZoomControls,
  Plane,
  PointDepthSlab,
  PointsRenderable,
  OrthographicCamera,
  OmeZarrImageSource,
  LayerState,
  ImageLayer,
  Color,
  createNoPrefetchPolicy,
  Viewport,
} from "@";

import { vec3 } from "gl-matrix";

const baseUrl =
  "https://files.cryoetdataportal.cziscience.com/10445/TS_100_3/Reconstructions/VoxelSpacing4.990";
const imageUrl = `${baseUrl}/Tomograms/100/TS_100_3.zarr`;
const ribosomesUrl = `${baseUrl}/Annotations/104/cytosolic_ribosome-1.0_point.ndjson`;
const ferritinUrl = `${baseUrl}/Annotations/101/ferritin_complex-1.0_point.ndjson`;
const virusLikeUrl = `${baseUrl}/Annotations/106/pp7_vlp-1.0_point.ndjson`;

// The tomogram's world units are Ångströms (the OME-Zarr axes say so, and the
// portal's "VoxelSpacing4.990" is in Å). Point coordinates are stored in the
// voxel space of the highest res image, so scale them by its voxel size to
// match world coordinates.
const IMAGE_SCALE_0 = 4.99; // Å per voxel at full resolution
// voxel size of the lowest res, used for the slice slider's range
const IMAGE_SCALE_2 = 19.96; // Å per voxel
const INITIAL_Z_POSITION = 918.16;
// Particles within this distance (Å) of the shown slice are drawn, shrinking
// and fading toward the slab's faces as if the slice cut through a ball.
// 500 Å is about one ribosome diameter either side of the slice.
const SLAB_THICKNESS = 500;

const fetchPositionsFromNDJson = async (url: string) => {
  return await fetch(url).then(async (response) => {
    const allPoints = await response.text();
    const points = allPoints
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    return points.map((point) => {
      let { x, y, z } = point["location"];
      x = x * IMAGE_SCALE_0;
      y = y * IMAGE_SCALE_0;
      z = z * IMAGE_SCALE_0;
      return [x, y, z] as vec3;
    });
  });
};

const ribosomeLocations = await fetchPositionsFromNDJson(ribosomesUrl);
const ferritinLocations = await fetchPositionsFromNDJson(ferritinUrl);
const virusLikeLocations = await fetchPositionsFromNDJson(virusLikeUrl);

type Marker = "circle" | "square" | "triangle";

// One slab shared by every particle layer: it follows the image slice, and
// moving it is a single assignment applied on the next draw. Flattening draws
// the kept particles on the slice plane so the image doesn't occlude them.
const slab: PointDepthSlab = {
  plane: new Plane([0, 0, 1], -INITIAL_Z_POSITION),
  thickness: SLAB_THICKNESS,
  flatten: true,
  falloff: "sphere",
  // Particles below the slice are drawn as outlines.
  behind: "hollow",
};

class Particles extends Layer {
  public readonly type = "Particles";

  /**
   * @param diameter - Marker diameter in world units (Å), so particles are
   *   drawn at their physical size and scale with zoom; a small pixel floor
   *   keeps them visible as dots when zoomed far out.
   */
  constructor(
    points: vec3[],
    color: ColorLike,
    marker: Marker,
    diameter: number
  ) {
    // Blend so the slab falloff can fade particles, not just shrink them,
    // and keep the layer translucent so the tomogram shows through.
    super({ blendMode: "normal" });
    this.opacity = 0.7;
    const renderable = new PointsRenderable(
      points.map((position) => ({ position, color, size: diameter, marker })),
      { sizeUnits: "world", minPixelSize: 4 }
    );
    renderable.depthSlab = slab;
    this.addObject(renderable);
    this.setState("ready");
  }

  /** Move the shared slab to the slice at `z`; no renderables are rebuilt. */
  public setDepth(z: number) {
    slab.plane.signedDistance = -z;
    this.invalidate();
  }

  public update(): boolean {
    return false;
  }
}
// Approximate particle diameters, Å.
const ribosomes = new Particles(ribosomeLocations, Color.RED, "circle", 200);
const ferritin = new Particles(ferritinLocations, Color.GREEN, "triangle", 100);
const virusLike = new Particles(
  virusLikeLocations,
  new Color(1.0, 0.0, 1.0),
  "square",
  240
);

const imageSource = await OmeZarrImageSource.fromHttp({ url: imageUrl });
const dimensions = imageSource.getDimensions();

const zDimName = "z";
const zMin = 0;
const lowestLod = dimensions.numLods - 1;
const zMax = dimensions.z!.lods[lowestLod].size;
const xLod = dimensions.x!.lods[lowestLod];
const yLod = dimensions.y!.lods[lowestLod];
const xExtent = xLod.size * xLod.scale;
const yExtent = yLod.size * yLod.scale;

const zSlider = document.querySelector<HTMLInputElement>("#z-slider")!;
zSlider.min = `${zMin}`;
zSlider.max = `${zMax - 1}`;
zSlider.value = `${INITIAL_Z_POSITION / IMAGE_SCALE_2}`;

const sliceCoords = { [zDimName]: INITIAL_Z_POSITION };

const imageLayer = new ImageLayer({
  source: imageSource,
  sliceCoords,
  policy: createNoPrefetchPolicy(),
  channelProps: [{ color: Color.WHITE, contrastLimits: [-0.00001, 0.00001] }],
});

const camera = new OrthographicCamera({
  left: 0,
  right: xExtent,
  top: 0,
  bottom: yExtent,
  near: -10000,
  far: 10000,
});
const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const viewport = new Viewport({
  domElement: canvas,
  camera,
  layers: [imageLayer],
});
new Idetik({ canvas, viewports: [viewport] }).start();

const onFirstImageLoad = (newState: LayerState) => {
  if (newState === "ready") {
    viewport.cameraControls = new PanZoomControls(camera);
    camera.update();

    viewport.addLayer(ribosomes);
    viewport.addLayer(ferritin);
    viewport.addLayer(virusLike);

    // remove the callback to only set the camera frame once
    imageLayer.removeStateChangeCallback(onFirstImageLoad);
  }
};

imageLayer.addStateChangeCallback(onFirstImageLoad);

let debounce: ReturnType<typeof setTimeout>;
zSlider.addEventListener("input", (event) => {
  clearTimeout(debounce);
  const value = (event.target as HTMLInputElement).valueAsNumber;
  debounce = setTimeout(() => {
    const worldZ = value * IMAGE_SCALE_2;
    sliceCoords[zDimName] = worldZ;
    ribosomes.setDepth(worldZ);
    ferritin.setDepth(worldZ);
    virusLike.setDepth(worldZ);
  }, 20);
});
