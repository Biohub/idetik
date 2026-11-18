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

const channelProps: (ChannelProps & { name: string })[] = [
  {
    name: "h2afva (nuclei)",
    visible: true,
    color: "#00b3ff",
    opacity: 1,
    contrastLimits: [0, 1200],
  },
  {
    name: "mezzo",
    visible: true,
    color: "#ff00bb",
    opacity: 1,
    contrastLimits: [0, 400],
  },
];

const volumeLayer = new VolumeLayer({
  source,
  sliceCoords,
  policy,
  channelProps: structuredClone(channelProps),
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

// The controls edit channelProps in place, and the layer gets a copy so it
// never sees an inverted contrast pair while one is being edited.
const updateChannels = () => {
  const valid = channelProps.every(
    ({ contrastLimits: [min, max] = [0, 1] }) => min < max
  );
  if (valid) volumeLayer.setChannelProps(structuredClone(channelProps));
};
const channelsFolder = gui.addFolder("Channels");
for (const channel of channelProps) {
  const folder = channelsFolder.addFolder(channel.name);
  folder.add(channel, "visible").name("Visible").onChange(updateChannels);
  folder.addColor(channel, "color").name("Color").onChange(updateChannels);
  folder
    .add(channel, "opacity", 0, 1, 0.01)
    .name("Opacity")
    .onChange(updateChannels);
  folder
    .add(channel.contrastLimits!, "0")
    .name("Contrast Min")
    .onChange(updateChannels);
  folder
    .add(channel.contrastLimits!, "1")
    .name("Contrast Max")
    .onChange(updateChannels);
}

const overlaysFolder = gui.addFolder("Debug");
overlaysFolder
  .add(volumeLayer, "debugShowWireframes")
  .name("Show tile wireframes");
overlaysFolder
  .add(volumeLayer, "debugShowDegenerateRays")
  .name("Show degenerate rays (length 0)");
