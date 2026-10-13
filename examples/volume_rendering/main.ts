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
} from "@";

const url =
  "https://public.czbiohub.org/organelle_box/datasets/A549/organelle_box_crop_v1.zarr/CLTA/PFA/002000/";
const source = await OmeZarrImageSource.fromHttp({ url });
const sliceCoords = {
  t: 0,
  z: undefined,
  c: undefined, // Show all channels
};
const controls = { lod: 2 };

const camera = new PerspectiveCamera();
const policy = createExplorationPolicy({
  lod: { min: controls.lod, max: controls.lod },
});

const channelNames = ["Phase 3D", "Prime DAPI", "Prime GFP"];
const channelProps: ChannelProps[] = [
  {
    visible: false,
    color: "#ffffff",
    contrastLimits: [-1.5, 10.0],
  },
  {
    visible: true,
    color: "#0000ff",
    contrastLimits: [108, 353],
  },
  {
    visible: true,
    color: "#00ff00",
    contrastLimits: [144, 3825],
  },
];

const volumeLayer = new VolumeLayer({
  source,
  sliceCoords,
  policy,
  channelProps,
});

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const idetik = new Idetik({
  canvas,
  viewports: [
    new Viewport({
      domElement: canvas,
      camera,
      cameraControls: new OrbitControls(camera, {
        radius: 100,
        target: vec3.fromValues(40, 40, 10), // Volume center,
      }),
      layers: [volumeLayer],
    }),
  ],
  showStats: true,
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
const gui = new GUI({ width: 500 });
gui
  .add(controls, "lod", 0, 2, 1)
  .name("Level of Detail (LOD)")
  .onChange(
    (lod: number) =>
      (volumeLayer.imageSourcePolicy = createExplorationPolicy({
        lod: { min: lod, max: lod },
      }))
  );

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
