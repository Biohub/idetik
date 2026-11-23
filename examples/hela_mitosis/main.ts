import GUI from "lil-gui";
import {
  ChannelProps,
  Idetik,
  ImageLayer,
  LabelLayer,
  OmeZarrImageSource,
  OrthographicCamera,
  PanZoomControls,
  Viewport,
} from "idetik";
import { addDimensionSlider } from "../lil_gui_utils";

// A HeLa cell dividing, imaged every 90 s for an hour: 40 time points of a
// 31-slice confocal stack with three channels, plus cell and chromosome
// segmentations that follow the same z and t sliders.

const DATA_URL = "https://data.idetik.org/examples/idr0052-hela-condensin";

const image = await OmeZarrImageSource.fromHttp({
  url: `${DATA_URL}/image.ome.zarr`,
  version: "0.5",
});
const labels = await OmeZarrImageSource.fromHttp({
  url: `${DATA_URL}/labels.ome.zarr`,
  version: "0.5",
});

const { x, y, z, t } = image.getDimensions();
const [xLod, yLod, zLod, tLod] = [x, y, z!, t!].map((d) => d.lods[0]);
const coord = (lod: typeof zLod, index: number) =>
  lod.translation + index * lod.scale;

const sliceCoords = {
  c: [0, 1, 2],
  z: coord(zLod, Math.floor(zLod.size / 2)),
  // 30 min in, just after the chromosomes separate.
  t: coord(tLod, 20),
};

const channels: (ChannelProps & { name: string })[] = [
  {
    name: "NCAPD2-mEGFP",
    color: "#00ff00",
    contrastLimits: [2000, 20000],
    visible: true,
  },
  {
    name: "SiR-DNA",
    color: "#ff00ff",
    contrastLimits: [3000, 25000],
    visible: true,
  },
  // A negative stain: bright everywhere outside the cell, so it's off at first.
  {
    name: "Dextran",
    color: "#606060",
    contrastLimits: [4000, 30000],
    visible: false,
  },
];

const imageLayer = new ImageLayer({
  source: image,
  sliceCoords,
  channelProps: channels,
});
const labelLayer = new LabelLayer({
  source: labels,
  sliceCoords,
  opacity: 0.4,
  blendMode: "normal",
  colorMap: {
    lookupTable: new Map([
      [1, "#00bfff"],
      [2, "#ffd700"],
    ]),
  },
});

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const camera = new OrthographicCamera({
  left: xLod.translation,
  right: coord(xLod, xLod.size),
  top: yLod.translation,
  bottom: coord(yLod, yLod.size),
});
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: new PanZoomControls(camera),
  layers: [imageLayer, labelLayer],
});
new Idetik({ canvas, viewports: [viewport] }).start();

const gui = new GUI({ width: 320 }).close();
addDimensionSlider({
  gui,
  sliceCoords,
  dimensionName: "z",
  lod: zLod,
});
addDimensionSlider({
  gui,
  sliceCoords,
  dimensionName: "t",
  lod: tLod,
  playback: { maxRateHz: 10 },
});

const labelState = { visible: true };
gui
  .add(labelState, "visible")
  .name("Show segmentation")
  .onChange((visible: boolean) =>
    visible ? viewport.addLayer(labelLayer) : viewport.removeLayer(labelLayer)
  );
const channelFolder = gui.addFolder("Channels");
for (const channel of channels) {
  channelFolder
    .add(channel, "visible")
    .name(channel.name)
    .onChange(() => imageLayer.setChannelProps(channels));
}
