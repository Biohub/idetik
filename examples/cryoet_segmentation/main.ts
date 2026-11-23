import GUI from "lil-gui";
import {
  Idetik,
  ImageLayer,
  LabelLayer,
  MeshLayer,
  MeshSource,
  OmeZarrImageSource,
  OrbitControls,
  OrthographicCamera,
  PanZoomControls,
  PerspectiveCamera,
  Viewport,
  VolumeLayer,
  createExplorationPolicy,
} from "idetik";

// A simulated CryoET tomogram with membrane, microtubule and actin
// segmentations, side by side: one mesh per class inside a volume rendering on
// the left, and a label image over an XY slice on the right.

const DATA_URL =
  "https://data.idetik.org/examples/cryoet10490-simulated-crowding";

const classes = [
  { name: "membrane", label: 1, color: "#ff9f1c" },
  { name: "microtubule", label: 2, color: "#2ec4b6" },
  { name: "actin_filament", label: 3, color: "#e71d73" },
];

const tomogram = await OmeZarrImageSource.fromHttp({
  url: `${DATA_URL}/tomogram.ome.zarr`,
  version: "0.5",
});
const labels = await OmeZarrImageSource.fromHttp({
  url: `${DATA_URL}/labels.ome.zarr`,
  version: "0.5",
});

const { x, y, z } = tomogram.getDimensions();
const [xLod, yLod, zLod] = [x.lods[0], y.lods[0], z!.lods[0]];
const width = xLod.size * xLod.scale;
const height = yLod.size * yLod.scale;
const depth = zLod.size * zLod.scale;

const channelProps2d = [{ contrastLimits: [-0.71, -0.26] as [number, number] }];
const channelProps3d = [{ contrastLimits: [-0.65, -0.4] as [number, number] }];

// === 2D: an XY slice with the labels on top ===
const zMid = Math.floor(zLod.size / 2);
const sliceCoords = { z: zLod.translation + zMid * zLod.scale };
const slice = new ImageLayer({
  source: tomogram,
  sliceCoords,
  channelProps: channelProps2d,
});
const labelSlice = new LabelLayer({
  source: labels,
  sliceCoords,
  opacity: 0.6,
  blendMode: "normal",
  colorMap: {
    lookupTable: new Map(classes.map((c) => [c.label, c.color])),
  },
});
const camera2d = new OrthographicCamera({
  left: 0,
  right: width,
  top: 0,
  bottom: height,
});

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const viewport2d = new Viewport({
  id: "xy",
  domElement: document.querySelector<HTMLDivElement>("#viewport-xy")!,
  camera: camera2d,
  cameraControls: new PanZoomControls(camera2d),
  layers: [slice, labelSlice],
});

// === 3D: the volume with one mesh per class ===
const volume = new VolumeLayer({
  source: tomogram,
  sliceCoords: {},
  policy: createExplorationPolicy({ lod: { min: 1, max: 1 } }),
  // Hidden at first: ice is the bright part of the tomogram, so it fills the
  // volume rendering and hides the protein.
  channelProps: [{ ...channelProps3d[0], visible: false }],
});
volume.opacityMultiplier = 0.002;
const meshes = classes.map(
  (c) =>
    new MeshLayer({
      source: new MeshSource({ url: `${DATA_URL}/${c.name}.glb` }),
      color: c.color,
    })
);
const camera3d = new PerspectiveCamera({ near: 10, far: 100_000 });
const viewport3d = new Viewport({
  id: "3d",
  domElement: document.querySelector<HTMLDivElement>("#viewport-3d")!,
  camera: camera3d,
  cameraControls: new OrbitControls(camera3d, {
    radius: 1.6 * Math.max(width, height),
    pitch: -0.6,
    target: [width / 2, height / 2, depth / 2],
  }),
  layers: [...meshes, volume],
});

const idetik = new Idetik({ canvas, viewports: [viewport3d, viewport2d] });
idetik.start();

// === Controls ===
const state = { z: zMid, annotations: true };
const gui = new GUI({ width: 320 }).close();
gui
  .add(state, "z", 0, zLod.size - 1, 1)
  .name("Z slice")
  .onChange((index: number) => {
    sliceCoords.z = zLod.translation + index * zLod.scale;
  });
gui
  .add(state, "annotations")
  .name("Show annotations")
  .onChange((show: boolean) => {
    if (show) {
      viewport2d.addLayer(labelSlice);
      meshes.forEach((mesh) => viewport3d.addLayer(mesh));
    } else {
      viewport2d.removeLayer(labelSlice);
      meshes.forEach((mesh) => viewport3d.removeLayer(mesh));
    }
  });

const volumeState = {
  visible: false,
  contrastMin: channelProps3d[0].contrastLimits[0],
  contrastMax: channelProps3d[0].contrastLimits[1],
  // Slider in [0, 1] mapped logarithmically to an opacity multiplier in [1e-4, 1].
  get opacity() {
    return (Math.log10(volume.opacityMultiplier) + 4) / 4;
  },
  set opacity(value: number) {
    volume.opacityMultiplier = Math.pow(10, value * 4 - 4);
  },
};
function updateVolume() {
  const { visible, contrastMin, contrastMax } = volumeState;
  if (contrastMin >= contrastMax) return;
  volume.setChannelProps([
    { visible, contrastLimits: [contrastMin, contrastMax] },
  ]);
}
const volumeFolder = gui.addFolder("Volume");
volumeFolder.add(volumeState, "visible").name("Show").onChange(updateVolume);
volumeFolder
  .add(volumeState, "contrastMin", -0.9, -0.08, 0.01)
  .name("Contrast min")
  .onChange(updateVolume);
volumeFolder
  .add(volumeState, "contrastMax", -0.9, -0.08, 0.01)
  .name("Contrast max")
  .onChange(updateVolume);
volumeFolder
  .add(volumeState, "opacity", 0, 1, 0.01)
  .name("Opacity")
  .decimals(2);
