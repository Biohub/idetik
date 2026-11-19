import {
  Idetik,
  ColorLike,
  Layer,
  PanZoomControls,
  PointsRenderable,
  OrthographicCamera,
  OmeZarrImageSource,
  ImageLayer,
  Color,
  createNoPrefetchPolicy,
  Viewport,
} from "idetik";

import { vec3 } from "gl-matrix";
import GUI from "lil-gui";
import { addDimensionSlider } from "../lil_gui_utils";

// CryoET Data Portal dataset 10445, run TS_100_3, re-chunked for 2D slicing.
const baseUrl = "https://data.idetik.org/examples/cryoet10445-czii-particles";

const imageSource = await OmeZarrImageSource.fromHttp({
  url: `${baseUrl}/TS_100_3.ome.zarr`,
  version: "0.5",
});
const dimensions = imageSource.getDimensions();
const [xLod, yLod, zLod] = [dimensions.x, dimensions.y, dimensions.z!].map(
  (d) => d.lods[0]
);

// Start on the middle slice.
const sliceCoords = {
  z: zLod.translation + Math.floor((zLod.size - 1) / 2) * zLod.scale,
};

// Point locations are full-resolution voxel indices, so scale them by the
// level-0 voxel size into world units (ångström).
const fetchPositions = async (name: string): Promise<vec3[]> => {
  const text = await fetch(`${baseUrl}/${name}-1.0_point.ndjson`).then((r) =>
    r.text()
  );
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const { x, y, z } = JSON.parse(line).location;
      return [x * xLod.scale, y * yLod.scale, z * zLod.scale];
    });
};

type Marker = "circle" | "square" | "triangle";

// Draws each particle as a marker that shrinks and dims with its distance
// from the current slice.
class Particles extends Layer {
  public readonly type = "Particles";
  private readonly points_: vec3[];
  private readonly color_: Color;
  private readonly marker_: Marker;
  private depth_?: number;

  constructor(points: vec3[], color: ColorLike, marker: Marker) {
    super();
    this.points_ = points;
    this.color_ = Color.from(color);
    this.marker_ = marker;
    this.update();
    this.setState("ready");
  }

  public update(): boolean {
    if (this.depth_ === sliceCoords.z) return false;
    this.depth_ = sliceCoords.z;

    // TODO: change this to not re-create the renderable object
    // once Geometry supports updating buffers
    const { r, g, b } = this.color_;
    const scaledPoints = this.points_.map((p) => {
      const zDist = Math.abs(p[2] - sliceCoords.z);
      // 64 is just a magic number that looks okay
      const zScale = zDist / 64.0 + 1.0;
      return {
        position: p,
        color: Color.from([r / zScale, g / zScale, b / zScale]),
        size: 20.0 / zScale,
        marker: this.marker_,
      };
    });
    this.clearObjects();
    this.addObject(new PointsRenderable(scaledPoints));
    return true;
  }
}

const particles = [
  new Particles(
    await fetchPositions("cytosolic_ribosome"),
    Color.RED,
    "circle"
  ),
  new Particles(
    await fetchPositions("ferritin_complex"),
    Color.GREEN,
    "triangle"
  ),
  new Particles(await fetchPositions("pp7_vlp"), Color.MAGENTA, "square"),
];

const imageLayer = new ImageLayer({
  source: imageSource,
  sliceCoords,
  policy: createNoPrefetchPolicy(),
  channelProps: [{ color: Color.WHITE, contrastLimits: [-0.00001, 0.00001] }],
});

// The particles sit at their own z, so the camera's depth range spans the
// whole tomogram.
const camera = new OrthographicCamera({
  left: xLod.translation,
  right: xLod.translation + xLod.size * xLod.scale,
  top: yLod.translation,
  bottom: yLod.translation + yLod.size * yLod.scale,
  near: -10000,
  far: 10000,
});
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: new PanZoomControls(camera),
  layers: [imageLayer, ...particles],
});
new Idetik({ canvas, viewports: [viewport] }).start();

addDimensionSlider({
  gui: new GUI({ width: 280 }).close(),
  sliceCoords,
  dimensionName: "z",
  lod: zLod,
});
