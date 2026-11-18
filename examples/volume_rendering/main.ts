import { vec3 } from "gl-matrix";
import GUI from "lil-gui";
import {
  ChannelProps,
  Idetik,
  OmeZarrImageSource,
  OrbitControls,
  PerspectiveCamera,
  VolumeLayer,
  createExplorationPolicy,
  Viewport,
} from "idetik";
import { addDimensionSlider } from "../lil_gui_utils";

// A zebrafish embryo imaged over 270 timepoints with multi-view light-sheet
// microscopy: a 5-level Zarr v2 pyramid of 396 × 1,624 × 1,552 voxels at
// 1.97 × 0.485 × 0.485 µm with two channels (h2afva nuclei, mezzo).
const url =
  "https://public.czbiohub.org/royerlab/zebrahub/imaging/multi-view/ZMNS001.ome.zarr/";
const source = await OmeZarrImageSource.fromHttp({ url });

const dims = source.getDimensions();
const axisRange = (axis: "x" | "y" | "z"): readonly [number, number] => {
  const d = dims[axis]!.lods[0];
  return [d.translation, d.translation + d.size * d.scale] as const;
};
const [xMin, xMax] = axisRange("x");
const [yMin, yMax] = axisRange("y");
const [zMin, zMax] = axisRange("z");
const center = vec3.fromValues(
  (xMin + xMax) / 2,
  (yMin + yMax) / 2,
  (zMin + zMax) / 2
);
const tLod = dims.t!.lods[0];

const sliceCoords = {
  t: 133,
  z: undefined,
  c: undefined, // Show all channels
};
// Level 0 is about 4 GB per timepoint, so the volume starts two levels down.
// The LOD slider shows the size of each level as a hint.
const controls = { lod: 2 };
const maxLod = dims.numLods - 1;
const BYTES_PER_VOXEL = 2; // uint16

function describeLod(lod: number): string {
  const voxels = (["x", "y", "z"] as const).reduce(
    (count, axis) => count * dims[axis]!.lods[lod].size,
    1
  );
  const bytes = voxels * channelProps.length * BYTES_PER_VOXEL;
  const size =
    bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(1)} GB`
      : `${Math.round(bytes / 1e6)} MB`;
  return `${size} per timepoint`;
}

const camera = new PerspectiveCamera();
const policy = createExplorationPolicy({
  lod: { min: controls.lod, max: controls.lod },
});

const channelNames = ["h2afva (nuclei)", "mezzo"];
const channelProps: ChannelProps[] = [
  {
    visible: true,
    color: "#00b3ff",
    contrastLimits: [0, 1200],
  },
  {
    visible: true,
    color: "#ff00bb",
    contrastLimits: [0, 400],
  },
];

const volumeLayer = new VolumeLayer({
  source,
  sliceCoords,
  policy,
  channelProps,
});
volumeLayer.opacityMultiplier = 0.02;

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const idetik = new Idetik({
  canvas,
  viewports: [
    new Viewport({
      domElement: canvas,
      camera,
      cameraControls: new OrbitControls(camera, {
        radius: 0.65 * Math.hypot(xMax - xMin, yMax - yMin, zMax - zMin),
        yaw: 0.4,
        pitch: 0.1,
        target: center,
      }),
      layers: [volumeLayer],
    }),
  ],
});

idetik.start();

function updateChannelProperty<K extends keyof ChannelProps>(
  channelIndex: number,
  property: K,
  value: ChannelProps[K]
) {
  let safeValue = value;
  if (property === "contrastLimits") {
    const [min, max] = value as [number, number];
    if (min >= max) return;
    safeValue = [min, max] as ChannelProps[K];
  }

  channelProps[channelIndex][property] = safeValue;
  volumeLayer.setChannelProps(channelProps);
}

function createChannelControls(
  folder: GUI,
  config: (typeof channelProps)[number],
  index: number
) {
  const channelName = channelNames[index] || `Channel ${index}`;
  const channelFolder = folder.addFolder(channelName);

  // Local version of the channel config to avoid mutating the original when adjusting contrast limits, e.g. if setting the max below the min
  const guiConfig: ChannelProps = {
    ...config,
    opacity: config.opacity ?? 1,
    contrastLimits: config.contrastLimits
      ? [config.contrastLimits[0], config.contrastLimits[1]]
      : undefined,
  };

  channelFolder
    .add(guiConfig, "visible")
    .name("Visible")
    .onChange((visible: boolean) => {
      updateChannelProperty(index, "visible", visible);
    });

  channelFolder
    .addColor(guiConfig, "color")
    .name("Color")
    .onChange((hex: string) => {
      updateChannelProperty(index, "color", hex);
    });

  channelFolder
    .add(guiConfig, "opacity", 0, 1, 0.01)
    .name("Opacity")
    .onChange((opacity: number) => {
      updateChannelProperty(index, "opacity", opacity);
    });

  if (guiConfig.contrastLimits) {
    channelFolder
      .add(guiConfig.contrastLimits, "0")
      .name("Contrast Min")
      .onChange(() => {
        updateChannelProperty(
          index,
          "contrastLimits",
          guiConfig.contrastLimits
        );
      });
    channelFolder
      .add(guiConfig.contrastLimits, "1")
      .name("Contrast Max")
      .onChange(() => {
        updateChannelProperty(
          index,
          "contrastLimits",
          guiConfig.contrastLimits
        );
      });
  }
}

// Add GUI controls to manipulate rendering
const gui = new GUI({ width: 320, closeFolders: true }).close();
addDimensionSlider({
  gui,
  sliceCoords,
  dimensionName: "t",
  lod: tLod,
});
const lodInfo = { size: describeLod(controls.lod) };
gui
  .add(controls, "lod", 0, maxLod, 1)
  .name("Level of Detail (LOD)")
  .onChange((lod: number) => {
    volumeLayer.imageSourcePolicy = createExplorationPolicy({
      lod: { min: lod, max: lod },
    });
    lodInfo.size = describeLod(lod);
    lodInfoController.updateDisplay();
  });
const lodInfoController = gui
  .add(lodInfo, "size")
  .name("Volume size")
  .disable();

const volumeFolder = gui.addFolder("Volume Rendering");
volumeFolder
  .add(volumeLayer, "relativeStepSize", 0.25, 3.0, 0.1)
  .name("Relative step size (voxels)");

// maps 0-1 slider to [0.001, 10.0] logarithmically
const opacityControls = {
  get opacity() {
    return (Math.log10(volumeLayer.opacityMultiplier) + 3) / 4;
  },
  set opacity(sliderValue: number) {
    volumeLayer.opacityMultiplier = Math.pow(10, sliderValue * 4 - 3);
  },
};
volumeFolder
  .add(opacityControls, "opacity", 0, 1, 0.01)
  .name("Opacity")
  .decimals(2);
volumeFolder
  .add(volumeLayer, "earlyTerminationAlpha", 0.8, 1.0, 0.01)
  .name("Early termination threshold");

const channelsFolder = gui.addFolder("Channels");
channelProps.forEach((config, index) => {
  createChannelControls(channelsFolder, config, index);
});

const overlaysFolder = gui.addFolder("Debug");
overlaysFolder
  .add(volumeLayer, "debugShowWireframes")
  .name("Show tile wireframes");
overlaysFolder
  .add(volumeLayer, "debugShowDegenerateRays")
  .name("Show degenerate rays (length 0)");
