import {
  Idetik,
  ImageLayer,
  OmeZarrImageSource,
  OrthographicCamera,
  PanZoomControls,
  createExplorationPolicy,
  createPlaybackPolicy,
  Viewport,
} from "idetik";
import { ScaleBar } from "../scale_bar";
import { addDimensionSlider } from "../lil_gui_utils";
import GUI from "lil-gui";

// A 2D slice through a 5D light-sheet timelapse of a zebrafish embryo:
// 791 timepoints × 448 z-planes of 2,174 × 2,423 pixels, from Zebrahub.
const url =
  "https://public.czbiohub.org/royerlab/zebrahub/imaging/single-objective/ZSNS001.ome.zarr/";
const source = await OmeZarrImageSource.fromHttp({ url });
const dimensions = source.getDimensions();

const xLod = dimensions.x.lods[0];
const yLod = dimensions.y.lods[0];
const zLod = dimensions.z!.lods[0];
const tLod = dimensions.t!.lods[0];
const midCoord = (lod: typeof zLod) =>
  lod.translation + Math.floor((lod.size - 1) / 2) * lod.scale;

const sliceCoords = { c: [0], z: midCoord(zLod), t: midCoord(tLod) };

// Prefetch a couple of z-planes around the slice and timepoints ahead of it
// so small slider moves show immediately. The t range is adjustable from
// the GUI.
const prefetchState = { t: 2 };
const makeExplorationPolicy = () =>
  createExplorationPolicy({
    prefetch: { x: 1, y: 1, z: 2, t: prefetchState.t },
  });
let explorationPolicy = makeExplorationPolicy();
let playing = false;

const channelState = { contrastMin: 0, contrastMax: 60, color: "#ffffff" };
const imageLayer = new ImageLayer({
  source,
  sliceCoords,
  policy: explorationPolicy,
  channelProps: [
    {
      visible: true,
      contrastLimits: [channelState.contrastMin, channelState.contrastMax],
      color: channelState.color,
    },
  ],
});

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const camera = new OrthographicCamera({
  left: xLod.translation,
  right: xLod.translation + xLod.scale * xLod.size,
  top: yLod.translation,
  bottom: yLod.translation + yLod.scale * yLod.size,
});
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: new PanZoomControls(camera),
  layers: [imageLayer],
});

// Shows the timepoint actually on screen, which lags the slider while
// chunks for the requested timepoint are still loading.
const timePointDiv = document.querySelector<HTMLDivElement>("#time-point")!;
const timePointOverlay = {
  update() {
    const time = imageLayer.lastPresentationTimeCoord;
    timePointDiv.textContent = time === undefined ? "" : `t = ${time}`;
  },
};

// A thin bar along the bottom showing how much of the requested data,
// including prefetch, is on the GPU.
const loadingFill = document.querySelector<HTMLDivElement>("#loading-fill")!;
let lastStatsTime = 0;
const loadingOverlay = {
  update(idetik: Idetik) {
    // Chunk stats walk every chunk, so sample them a few times a second.
    const now = performance.now();
    if (now - lastStatsTime < 100) return;
    lastStatsTime = now;
    const [stats] = idetik.stats.chunks.viewports;
    const fraction = stats?.requested
      ? Math.min(1, stats.resident / stats.requested)
      : 1;
    loadingFill.style.width = `${100 * fraction}%`;
  },
};

const scaleBar = new ScaleBar({
  boxDiv: document.querySelector<HTMLDivElement>("#scale-bar-box")!,
  textDiv: document.querySelector<HTMLDivElement>("#scale-bar-text")!,
  lineDiv: document.querySelector<HTMLDivElement>("#scale-bar-line")!,
  unit: dimensions.x.unit ?? "",
});

const idetik = new Idetik({
  canvas,
  viewports: [viewport],
  overlays: [timePointOverlay, loadingOverlay, scaleBar],
});
idetik.start();

const gui = new GUI({ width: 380 }).close();

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
  playback: {
    // The playback policy skips prefetching neighbors and favors the LODs
    // that can keep up, trading detail for frame rate.
    onRateChange: (rateHz: number) => {
      playing = rateHz > 0;
      imageLayer.imageSourcePolicy = playing
        ? createPlaybackPolicy()
        : explorationPolicy;
    },
  },
});
gui
  .add(prefetchState, "t", 0, 20, 1)
  .name("t-prefetch (timepoints ahead)")
  .onChange(() => {
    explorationPolicy = makeExplorationPolicy();
    if (!playing) imageLayer.imageSourcePolicy = explorationPolicy;
  });

const channelFolder = gui.addFolder("Channel");
channelFolder
  .add(channelState, "contrastMin")
  .name("Contrast min")
  .onChange(updateChannel);
channelFolder
  .add(channelState, "contrastMax")
  .name("Contrast max")
  .onChange(updateChannel);
channelFolder
  .addColor(channelState, "color")
  .name("Color")
  .onChange(updateChannel);

function updateChannel() {
  if (channelState.contrastMin >= channelState.contrastMax) return;
  imageLayer.setChannelProps([
    {
      visible: true,
      contrastLimits: [channelState.contrastMin, channelState.contrastMax],
      color: channelState.color,
    },
  ]);
}

const debugState = { showWireframes: imageLayer.debugMode };
gui
  .addFolder("Debug")
  .add(debugState, "showWireframes")
  .name("Show tile wireframes")
  .onChange((show: boolean) => (imageLayer.debugMode = show));
