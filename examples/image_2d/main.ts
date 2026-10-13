import {
  ChannelProps,
  Idetik,
  ImageLayer,
  OmeZarrImageSource,
  OrbitControls,
  OrthographicCamera,
  PanZoomControls,
  PerspectiveCamera,
  SliceCoordinates,
  createExplorationPolicy,
  createPlaybackPolicy,
  Viewport,
} from "@";
import { ScaleBar } from "./scale_bar";
import { addDimensionSlider } from "../lil_gui_utils";
import GUI from "lil-gui";
import { vec3 } from "gl-matrix";

// A 2D OME-Zarr image viewer with a dataset selector. Pre-populated with
// public datasets covering both Zarr v2 (OME-Zarr 0.4) and Zarr v3 (OME-Zarr
// 0.5), plus a custom-URL field.

type DatasetConfig = {
  id: string;
  label: string;
  url: string;
  version?: "0.4" | "0.5";
  channel: number;
  contrastLimits: [number, number];
  channelColor?: string;
};

const PRESETS: DatasetConfig[] = [
  {
    id: "zebrahub",
    label: "Zebrahub (zarr v2)",
    url: "https://public.czbiohub.org/royerlab/zebrahub/imaging/single-objective/ZSNS001.ome.zarr/",
    channel: 0,
    contrastLimits: [0, 60],
  },
  {
    id: "exaspim",
    label: "exaSPIM Fused (zarr v2, large)",
    url: "https://aind-open-data.s3.amazonaws.com/exaSPIM_822177_2026-04-24_17-36-07_processed_2026-05-04_09-30-27/fusion/fused.zarr/",
    channel: 0,
    contrastLimits: [0, 15],
    channelColor: "#00ffff",
  },
  {
    id: "gfp_ca_waves",
    label: "GFP Ca wave dynamics (zarr v3)",
    url: "https://uk1s3.embassy.ebi.ac.uk/ebi-ngff-challenge-2024/c0e5d621-62cc-43a6-9dad-2ddab8959d17.zarr",
    version: "0.5",
    channel: 1,
    contrastLimits: [409, 3000],
    channelColor: "#00ff00",
  },
  {
    id: "marmoset_neurons",
    label: "Marmoset Neurons (zarr v3)",
    url: "https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2/marmoset_neurons.ome.zarr",
    version: "0.5",
    channel: 0,
    contrastLimits: [0, 1],
  },
];

const CUSTOM_LABEL = "Custom URL...";

function parseHash(): {
  preset?: DatasetConfig;
  customUrl?: string;
} {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const datasetId = params.get("dataset");
  if (datasetId) {
    const preset = PRESETS.find((p) => p.id === datasetId);
    if (preset) return { preset };
  }
  const url = params.get("url");
  if (url) return { customUrl: url };
  return { preset: PRESETS[0] };
}

function setHashAndReload(hash: string) {
  window.location.hash = hash;
  window.location.reload();
}

const parsed = parseHash();
const config: DatasetConfig = parsed.preset ?? {
  id: "custom",
  label: "Custom",
  url: parsed.customUrl!,
  channel: 0,
  contrastLimits: [0, 65535],
};

const datasetInfoDiv = document.querySelector<HTMLDivElement>("#dataset-info")!;
datasetInfoDiv.textContent = `Loading ${config.label}…\n${config.url}`;

const source = await OmeZarrImageSource.fromHttp({
  url: config.url,
  version: config.version,
});
const dimensions = source.getDimensions();

const xLod = dimensions.x.lods[0];
const yLod = dimensions.y.lods[0];
const zLod = dimensions.z?.lods[0];
const tLod = dimensions.t?.lods[0];

const sliceCoords: SliceCoordinates = {
  c: [config.channel],
};
if (zLod) {
  const midIndex = Math.floor((zLod.size - 1) / 2);
  sliceCoords.z = zLod.translation + midIndex * zLod.scale;
}
if (tLod) {
  const midIndex = Math.floor((tLod.size - 1) / 2);
  sliceCoords.t = tLod.translation + midIndex * tLod.scale;
}

const channelCount = source.getChannelCount();
const channelProps: ChannelProps[] = Array.from(
  { length: channelCount },
  (_, idx) =>
    idx === config.channel
      ? {
          visible: true,
          contrastLimits: config.contrastLimits,
          color: config.channelColor ?? "#ffffff",
        }
      : { visible: false }
);

const imageLayer = new ImageLayer({
  source,
  sliceCoords,
  channelProps,
});

const xMin = xLod.translation;
const xMax = xLod.translation + xLod.scale * xLod.size;
const yMin = yLod.translation;
const yMax = yLod.translation + yLod.scale * yLod.size;

const FOV_DEGREES = 60;
const orbitRadius =
  (yMax - yMin) / 2 / Math.tan((FOV_DEGREES * Math.PI) / 180 / 2);
const orbitTarget = vec3.fromValues(
  (xMin + xMax) / 2,
  (yMin + yMax) / 2,
  sliceCoords.z ?? 0
);

type Projection = "orthographic" | "perspective";

const layers = [imageLayer];
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;

const orthographicCamera = new OrthographicCamera({
  left: xMin,
  right: xMax,
  top: yMin,
  bottom: yMax,
});
const perspectiveCamera = new PerspectiveCamera({
  fov: FOV_DEGREES,
  near: orbitRadius / 100,
  far: orbitRadius * 10,
});
const viewports = {
  orthographic: new Viewport({
    domElement: canvas,
    camera: orthographicCamera,
    cameraControls: new PanZoomControls(orthographicCamera),
    layers,
  }),
  perspective: new Viewport({
    domElement: canvas,
    camera: perspectiveCamera,
    cameraControls: new OrbitControls(perspectiveCamera, {
      radius: orbitRadius,
      yaw: 0,
      pitch: 0,
      target: orbitTarget,
    }),
    layers,
  }),
};
let viewport = viewports.orthographic;

const timePointDiv = document.querySelector<HTMLDivElement>("#time-point")!;
if (!tLod) timePointDiv.style.display = "none";
const timePointOverlay = {
  update() {
    const time = imageLayer.lastPresentationTimeCoord;
    timePointDiv.textContent = time === undefined ? "" : `t = ${time}`;
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
  overlays: [timePointOverlay, scaleBar],
  showStats: true,
});
idetik.start();

datasetInfoDiv.innerHTML = formatDatasetInfo(config, dimensions);

const gui = new GUI({ width: 380 });

const datasetState = {
  selection: parsed.preset?.label ?? CUSTOM_LABEL,
  customUrl: parsed.customUrl ?? "",
};
const allLabels = [...PRESETS.map((p) => p.label), CUSTOM_LABEL];
const datasetSelect = gui
  .add(datasetState, "selection", allLabels)
  .name("Dataset");
const customUrlController = gui
  .add(datasetState, "customUrl")
  .name("Custom URL");
const customLoadController = gui
  .add(
    {
      load: () => {
        const url = datasetState.customUrl.trim();
        if (!url) return;
        setHashAndReload(`#url=${encodeURIComponent(url)}`);
      },
    },
    "load"
  )
  .name("Load custom URL");
function updateCustomVisibility(label: string) {
  if (label === CUSTOM_LABEL) {
    customUrlController.show();
    customLoadController.show();
  } else {
    customUrlController.hide();
    customLoadController.hide();
  }
}
datasetSelect.onChange((label: string) => {
  updateCustomVisibility(label);
  if (label === CUSTOM_LABEL) {
    // Stay put; user enters URL below and clicks Load.
    return;
  }
  const preset = PRESETS.find((p) => p.label === label);
  if (preset) setHashAndReload(`#dataset=${preset.id}`);
});
updateCustomVisibility(datasetState.selection);

if (zLod && zLod.size > 1) {
  addDimensionSlider({
    gui,
    sliceCoords,
    dimensionName: "z",
    minValue: zLod.translation,
    maxValue: zLod.translation + (zLod.size - 1) * zLod.scale,
    stepValue: zLod.scale,
    playback: {},
  });
}
if (tLod && tLod.size > 1) {
  addDimensionSlider({
    gui,
    sliceCoords,
    dimensionName: "t",
    minValue: tLod.translation,
    maxValue: tLod.translation + (tLod.size - 1) * tLod.scale,
    stepValue: tLod.scale,
    playback: {
      onRateChange: (rateHz: number) => {
        imageLayer.imageSourcePolicy =
          rateHz > 0 ? createPlaybackPolicy() : createExplorationPolicy();
      },
    },
  });
}

const channelFolder = gui.addFolder("Channel");
const channelState = {
  contrastMin: config.contrastLimits[0],
  contrastMax: config.contrastLimits[1],
  color: config.channelColor ?? "#ffffff",
};
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
  const next = Array.from({ length: channelCount }, (_, idx) =>
    idx === config.channel
      ? {
          visible: true,
          contrastLimits: [
            channelState.contrastMin,
            channelState.contrastMax,
          ] as [number, number],
          color: channelState.color,
        }
      : { visible: false }
  );
  imageLayer.setChannelProps(next);
}

const debugFolder = gui.addFolder("Debug");

const projectionState = { projection: "orthographic" as Projection };
debugFolder
  .add(projectionState, "projection", ["orthographic", "perspective"])
  .name("Projection")
  .onChange((projection: Projection) => {
    idetik.removeViewport(viewport);
    viewport = viewports[projection];
    idetik.addViewport(viewport);
  });

const debugState = { showWireframes: imageLayer.debugMode };
debugFolder
  .add(debugState, "showWireframes")
  .name("Show tile wireframes")
  .onChange((show: boolean) => (imageLayer.debugMode = show));

void idetik;

function formatDatasetInfo(
  cfg: DatasetConfig,
  dims: ReturnType<typeof source.getDimensions>
): string {
  const xL = dims.x.lods[0];
  const yL = dims.y.lods[0];
  const zL = dims.z?.lods[0];
  const tL = dims.t?.lods[0];
  const cL = dims.c?.lods[0];
  const shape = [tL?.size, cL?.size, zL?.size, yL.size, xL.size]
    .filter((v) => v !== undefined)
    .join(" × ");
  const scale = [zL?.scale, yL.scale, xL.scale]
    .filter((v) => v !== undefined)
    .map((v) => v!.toPrecision(3))
    .join(" × ");
  const unit = dims.x.unit ?? "";
  const escapedLabel = cfg.label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  let totalChunks = 0;
  for (let lod = 0; lod < dims.numLods; ++lod) {
    const xLod = dims.x.lods[lod];
    const yLod = dims.y.lods[lod];
    const zLod = dims.z?.lods[lod];
    const chunksX = Math.ceil(xLod.size / xLod.chunkSize);
    const chunksY = Math.ceil(yLod.size / yLod.chunkSize);
    const chunksZ = zLod ? Math.ceil(zLod.size / zLod.chunkSize) : 1;
    const chunksT = tL?.size ?? 1;
    const chunksC = cL?.size ?? 1;
    totalChunks += chunksT * chunksC * chunksZ * chunksY * chunksX;
  }

  return (
    `<div class="label">${escapedLabel}</div>` +
    `<div class="meta">` +
    [
      `shape:  ${shape}`,
      `LODs:   ${dims.numLods}`,
      `chunks: ${totalChunks.toLocaleString()}`,
      `voxel:  ${scale}${unit ? " " + unit : ""}`,
    ].join("\n") +
    `</div>`
  );
}
