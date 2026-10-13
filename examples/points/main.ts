import {
  Idetik,
  ColorLike,
  Layer,
  PanZoomControls,
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

// image scale for the highest res image --
// point coordinates are stored in the pixel-space of
// the highest res image, and need to be scaled
// by this factor to match our world coordinates
const IMAGE_SCALE_0 = 4.99; // nm/px
// image scale for the lowest res --
// this is the scale of the image we show
// it is used for scaling of the slice/depth
const IMAGE_SCALE_2 = 19.96; // nm/px
const INITIAL_Z_POSITION = 918.16;

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

class Particles extends Layer {
  public readonly type = "Particles";
  private readonly points_: vec3[] = [];
  private readonly color_: Color;
  private readonly marker_: Marker;
  private needsUpdate_: boolean = true;
  private depth_: number = 0;

  constructor(points: vec3[], color: ColorLike, marker: Marker) {
    super();
    this.setState("initialized");
    this.points_ = points;
    this.color_ = Color.from(color);
    this.marker_ = marker;
    this.refreshPointsRenderable();
    this.setState("ready");
  }

  public setDepth(z: number) {
    this.depth_ = z;
    this.needsUpdate_ = true;
  }

  public update() {
    if (!this.needsUpdate_) {
      return;
    }
    this.refreshPointsRenderable();
    this.needsUpdate_ = false;
  }

  private refreshPointsRenderable() {
    // TODO: change this to not re-create the renderable object
    // once Geometry supports updating buffers
    const { r, g, b } = this.color_;
    const scaledPoints = this.points_.map((p) => {
      const zDist = Math.abs(p[2] - this.depth_);
      // 64 is just a magic number that looks okay
      const zScale = zDist / 64.0 + 1.0;
      return {
        position: p,
        color: Color.from([r / zScale, g / zScale, b / zScale]),
        size: 20.0 / zScale,
        marker: this.marker_,
      };
    });
    const pointsRenderable = new PointsRenderable(scaledPoints);
    this.clearObjects();
    this.addObject(pointsRenderable);
  }
}
const ribosomes = new Particles(ribosomeLocations, Color.RED, "circle");
const ferritin = new Particles(ferritinLocations, Color.GREEN, "triangle");
const virusLike = new Particles(
  virusLikeLocations,
  new Color(1.0, 0.0, 1.0),
  "square"
);
ribosomes.setDepth(INITIAL_Z_POSITION);
ferritin.setDepth(INITIAL_Z_POSITION);
virusLike.setDepth(INITIAL_Z_POSITION);

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
