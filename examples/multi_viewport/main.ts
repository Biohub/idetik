import {
  ChannelProps,
  Idetik,
  ImageLayer,
  OmeZarrImageSource,
  OrbitControls,
  OrthographicCamera,
  PanZoomControls,
  PerspectiveCamera,
  SliceOrientation,
  VolumeLayer,
  createPlaybackPolicy,
  Viewport,
} from "idetik";
import { addDimensionSlider } from "../lil_gui_utils";
import { vec3 } from "gl-matrix";

import GUI from "lil-gui";

// A whole mouse brain imaged with exaSPIM light-sheet microscopy: a 7-level
// Zarr v2 pyramid of 21,041 × 40,660 × 66,934 voxels at 1 × 0.75 × 0.75 µm,
// streamed from the Allen Institute for Neural Dynamics open-data bucket.
// Dataset exaSPIM_822177_2026-04-24_17-36-07, CC BY 4.0:
// https://registry.opendata.aws/allen-nd-open-data
const url =
  "https://aind-open-data.s3.amazonaws.com/exaSPIM_822177_2026-04-24_17-36-07_processed_2026-05-04_09-30-27/fusion/fused.zarr/";

const source = await OmeZarrImageSource.fromHttp({ url });

const baseLod = 0;
const dims = source.getDimensions();
const axisRange = (axis: "x" | "y" | "z"): readonly [number, number] => {
  const d = dims[axis]!.lods[baseLod];
  return [d.translation, d.translation + d.size * d.scale] as const;
};
const [xMin, xMax] = axisRange("x");
const [yMin, yMax] = axisRange("y");
const [zMin, zMax] = axisRange("z");
const step = (axis: "x" | "y" | "z") => dims[axis]!.lods[baseLod].scale;

const center = vec3.fromValues(
  (xMin + xMax) / 2,
  (yMin + yMax) / 2,
  (zMin + zMax) / 2
);

// Tissue sits around 5-20 counts over a ~5-count background, so the slices
// use a tight window and the volume starts above background to stay clear.
const sliceChannelProps: ChannelProps[] = [
  { color: "#ffffff", contrastLimits: [2, 20] },
];
const volumeChannelProps: ChannelProps[] = [
  { color: "#00e5ff", contrastLimits: [6, 30] },
];

const sliceCoords = {
  t: 0,
  x: center[0],
  y: center[1],
  z: center[2],
  c: [0],
};

function createSliceLayer(orientation: SliceOrientation) {
  return new ImageLayer({
    source,
    sliceCoords,
    policy: createPlaybackPolicy(),
    channelProps: sliceChannelProps,
    orientation,
  });
}

function createSliceViewport(
  id: string,
  orientation: SliceOrientation,
  [uMin, uMax]: readonly [number, number],
  [vMin, vMax]: readonly [number, number]
) {
  const uPad = 0.2 * (uMax - uMin);
  const vPad = 0.2 * (vMax - vMin);
  const camera = new OrthographicCamera({
    left: uMin - uPad,
    right: uMax + uPad,
    top: vMin - vPad,
    bottom: vMax + vPad,
    orientation,
  });

  return new Viewport({
    id,
    domElement: document.querySelector<HTMLDivElement>(`#viewport-${id}`)!,
    camera,
    cameraControls: new PanZoomControls(camera),
    layers: [createSliceLayer(orientation)],
  });
}

// The coarsest level is still 328 × 635 × 1045 voxels (45 chunks), so the
// volume is pinned there.
const volumeLod = dims.x!.lods.length - 1;
const volumeLayer = new VolumeLayer({
  source,
  sliceCoords: { t: 0, c: [0] },
  policy: createPlaybackPolicy({ lod: { min: volumeLod, max: volumeLod } }),
  channelProps: volumeChannelProps,
});
volumeLayer.opacityMultiplier = 0.01;

const xRange = [xMin, xMax] as const;
const yRange = [yMin, yMax] as const;
const zRange = [zMin, zMax] as const;

// World units are micrometers and the brain spans ~50 mm, so push the far
// plane well past the orbit radius.
const diagonal = Math.hypot(xMax - xMin, yMax - yMin, zMax - zMin);
const camera3D = new PerspectiveCamera({
  near: diagonal / 1000,
  far: diagonal * 10,
});

const slicesIn3D = [
  createSliceLayer("XY"),
  createSliceLayer("XZ"),
  createSliceLayer("YZ"),
];
const viewport3D = new Viewport({
  id: "3d",
  domElement: document.querySelector<HTMLDivElement>("#viewport-3d")!,
  camera: camera3D,
  cameraControls: new OrbitControls(camera3D, {
    radius: diagonal,
    yaw: 0.4,
    pitch: 0.1,
    target: center,
  }),
  layers: [...slicesIn3D, volumeLayer],
});

new Idetik({
  canvas: document.querySelector<HTMLCanvasElement>("#canvas")!,
  viewports: [
    createSliceViewport("slice-xy", "XY", xRange, yRange),
    createSliceViewport("slice-xz", "XZ", xRange, zRange),
    createSliceViewport("slice-yz", "YZ", yRange, zRange),
    viewport3D,
  ],
}).start();

const gui = new GUI({ width: 300 }).close();

// Removing the slice layers from the 3D viewport (rather than fading them)
// also stops them from streaming chunks while hidden.
const view3D = { showSlices: true };
gui
  .add(view3D, "showSlices")
  .name("Show slices in 3D")
  .onChange((show: boolean) => {
    for (const layer of slicesIn3D) {
      if (show) viewport3D.addLayer(layer);
      else viewport3D.removeLayer(layer);
    }
  });

addDimensionSlider({
  gui,
  sliceCoords,
  dimensionName: "x",
  minValue: xMin,
  maxValue: xMax,
  stepValue: step("x"),
});

addDimensionSlider({
  gui,
  sliceCoords,
  dimensionName: "y",
  minValue: yMin,
  maxValue: yMax,
  stepValue: step("y"),
});

addDimensionSlider({
  gui,
  sliceCoords,
  dimensionName: "z",
  minValue: zMin,
  maxValue: zMax,
  stepValue: step("z"),
});
