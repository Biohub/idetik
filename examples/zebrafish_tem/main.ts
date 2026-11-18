import {
  Idetik,
  ImageLayer,
  OmeZarrImageSource,
  OrthographicCamera,
  PanZoomControls,
  Viewport,
} from "idetik";
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

// The minimap is a second viewport framed to the whole slide. A viewport
// can't share a layer, so it gets its own; the small viewport only loads the
// coarsest tiles.
const minimapDiv = document.querySelector<HTMLDivElement>("#minimap")!;
const minimapView = document.querySelector<HTMLDivElement>("#minimap-view")!;
const width = extent.right - extent.left;
const height = extent.bottom - extent.top;
minimapDiv.style.aspectRatio = `${width} / ${height}`;
const minimapLayer = new ImageLayer({
  source,
  sliceCoords: { c: [0] },
  channelProps: channelProps(),
});
const minimap = new Viewport({
  domElement: minimapDiv,
  camera: new OrthographicCamera(extent),
  layers: [minimapLayer],
});

const minimapState = { show: true };
const minimapOverlay = {
  update() {
    const { min, max } = camera.getWorldViewRect();
    const left = (Math.min(min[0], max[0]) - extent.left) / width;
    const top = (Math.min(min[1], max[1]) - extent.top) / height;
    const w = Math.abs(max[0] - min[0]) / width;
    const h = Math.abs(max[1] - min[1]) / height;
    // Tolerance for float error in the initial fit-to-slide view.
    const eps = 1e-6;
    const showsWholeSlide =
      left <= eps && top <= eps && left + w >= 1 - eps && top + h >= 1 - eps;
    minimapDiv.style.visibility =
      minimapState.show && !showsWholeSlide ? "" : "hidden";
    minimapView.style.left = `${100 * left}%`;
    minimapView.style.top = `${100 * top}%`;
    minimapView.style.width = `${100 * w}%`;
    minimapView.style.height = `${100 * h}%`;
  },
};

// Click or drag in the minimap to center the main view there.
function panTo(e: PointerEvent) {
  if (!(e.buttons & 1)) return;
  const target = minimap.clientToWorld([e.clientX, e.clientY]);
  const { min, max } = camera.getWorldViewRect();
  camera.pan([
    target[0] - (min[0] + max[0]) / 2,
    target[1] - (min[1] + max[1]) / 2,
    0,
  ]);
}
minimapDiv.addEventListener("pointerdown", (e) => {
  minimapDiv.setPointerCapture(e.pointerId);
  panTo(e);
});
minimapDiv.addEventListener("pointermove", panTo);

const idetik = new Idetik({
  canvas,
  viewports: [viewport, minimap],
  overlays: [scaleBar, minimapOverlay],
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

gui.add(minimapState, "show").name("Show minimap");

const debugState = { showWireframes: imageLayer.debugMode };
gui
  .addFolder("Debug")
  .add(debugState, "showWireframes")
  .name("Show tile wireframes")
  .onChange((show: boolean) => (imageLayer.debugMode = show));
