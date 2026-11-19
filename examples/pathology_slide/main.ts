import {
  Idetik,
  ImageLayer,
  OmeZarrImageSource,
  OrthographicCamera,
  PanZoomControls,
  Viewport,
} from "idetik";
import { Minimap } from "../minimap";

// A 45056 × 35840 H&E whole-slide image of a lymph node (OpenSlide's Philips-1
// test slide, from CAMELYON16) stored as three channels. Drawing them as red,
// green and blue blends them back into the slide's true color.

const DATA_URL = "https://data.idetik.org/examples/openslide-philips1-lymph-node";

const source = await OmeZarrImageSource.fromHttp({
  url: `${DATA_URL}/Philips-1.ome.zarr`,
  version: "0.5",
});
const { x, y } = source.getDimensions();
const [xLod, yLod] = [x.lods[0], y.lods[0]];
const extent = {
  left: xLod.translation,
  right: xLod.translation + xLod.scale * xLod.size,
  top: yLod.translation,
  bottom: yLod.translation + yLod.scale * yLod.size,
};

const rgb = () =>
  new ImageLayer({
    source,
    sliceCoords: { c: [0, 1, 2] },
    channelProps: ["#ff0000", "#00ff00", "#0000ff"].map((color) => ({
      color,
      contrastLimits: [0, 255] as [number, number],
    })),
  });

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const camera = new OrthographicCamera(extent);
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: new PanZoomControls(camera),
  layers: [rgb()],
});

const minimap = new Minimap({
  camera,
  extent,
  layer: rgb(),
  element: document.querySelector<HTMLDivElement>("#minimap")!,
});

new Idetik({
  canvas,
  viewports: [viewport, minimap.viewport],
  overlays: [minimap],
}).start();
