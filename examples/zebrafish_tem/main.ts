import {
  Idetik,
  ImageLayer,
  OmeZarrImageSource,
  OrthographicCamera,
  PanZoomControls,
  Viewport,
} from "idetik";
import { Minimap } from "../minimap";
import { ScaleBar } from "../scale_bar";
import GUI from "lil-gui";

// A 2D viewer for a 350-gigapixel TEM virtual slide: 380,928 × 921,600
// pixels streamed as 1024 × 1024 tiles from an 8-level pyramid.

const DATASET_URL =
  "https://data.idetik.org/examples/idr0053-zebrafish-tem/4495402.ome.zarr";

const source = await OmeZarrImageSource.fromHttp({
  url: DATASET_URL,
  version: "0.5",
});
const dimensions = source.getDimensions();
const xLod = dimensions.x.lods[0];
const yLod = dimensions.y.lods[0];

const extent = {
  left: xLod.translation,
  right: xLod.translation + xLod.scale * xLod.size,
  top: yLod.translation,
  bottom: yLod.translation + yLod.scale * yLod.size,
};

const channelState = { contrastMin: 0, contrastMax: 255, color: "#ffffff" };
const channelProps = () => [
  {
    visible: true,
    contrastLimits: [channelState.contrastMin, channelState.contrastMax] as [
      number,
      number,
    ],
    color: channelState.color,
  },
];
const imageLayer = new ImageLayer({
  source,
  sliceCoords: { c: [0] },
  channelProps: channelProps(),
});

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const camera = new OrthographicCamera(extent);
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: new PanZoomControls(camera),
  layers: [imageLayer],
});

const scaleBar = new ScaleBar({
  boxDiv: document.querySelector<HTMLDivElement>("#scale-bar-box")!,
  textDiv: document.querySelector<HTMLDivElement>("#scale-bar-text")!,
  lineDiv: document.querySelector<HTMLDivElement>("#scale-bar-line")!,
  unit: dimensions.x.unit ?? "",
});

const minimapLayer = new ImageLayer({
  source,
  sliceCoords: { c: [0] },
  channelProps: channelProps(),
});
const minimap = new Minimap({
  camera,
  extent,
  layer: minimapLayer,
  element: document.querySelector<HTMLDivElement>("#minimap")!,
});

const idetik = new Idetik({
  canvas,
  viewports: [viewport, minimap.viewport],
  overlays: [scaleBar, minimap],
});
idetik.start();

const gui = new GUI({ width: 380 }).close();
const channelFolder = gui.addFolder("Channel");
channelFolder
  .add(channelState, "contrastMin", 0, 255, 1)
  .name("Contrast min")
  .onChange(updateChannel);
channelFolder
  .add(channelState, "contrastMax", 0, 255, 1)
  .name("Contrast max")
  .onChange(updateChannel);
channelFolder
  .addColor(channelState, "color")
  .name("Color")
  .onChange(updateChannel);

function updateChannel() {
  if (channelState.contrastMin >= channelState.contrastMax) return;
  imageLayer.setChannelProps(channelProps());
  minimapLayer.setChannelProps(channelProps());
}

gui.add(minimap, "enabled").name("Show minimap");

const debugState = { showWireframes: imageLayer.debugMode };
gui
  .addFolder("Debug")
  .add(debugState, "showWireframes")
  .name("Show tile wireframes")
  .onChange((show: boolean) => (imageLayer.debugMode = show));
