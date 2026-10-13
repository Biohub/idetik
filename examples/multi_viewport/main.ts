import {
  ChannelProps,
  Color,
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
} from "@";
import { addDimensionSlider } from "../lil_gui_utils";
import { vec3 } from "gl-matrix";

import GUI from "lil-gui";

const url =
  "https://public.czbiohub.org/royerlab/zebrahub/imaging/multi-view/ZMNS001.ome.zarr/";

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

const timeCount = dims.t?.lods[baseLod].size ?? 1;
const center = vec3.fromValues(
  (xMin + xMax) / 2,
  (yMin + yMax) / 2,
  (zMin + zMax) / 2
);

const currentTime = { t: Math.floor((timeCount - 1) / 2) };

const channelProps: ChannelProps[] = [
  { color: Color.CYAN, contrastLimits: [0, 1200] },
  { color: Color.MAGENTA, contrastLimits: [0, 400] },
];

const sliceCoords = {
  get t() {
    return currentTime.t;
  },
  x: center[0],
  y: center[1],
  z: center[2],
  c: [0, 1],
};

function createSliceLayer(orientation: SliceOrientation) {
  return new ImageLayer({
    source,
    sliceCoords,
    policy: createPlaybackPolicy(),
    channelProps,
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

const volumeLod = Math.min(2, dims.x!.lods.length - 1);
const volumeLayer = new VolumeLayer({
  source,
  sliceCoords: {
    get t() {
      return currentTime.t;
    },
    c: [0, 1],
  },
  policy: createPlaybackPolicy({ lod: { min: volumeLod, max: volumeLod } }),
  channelProps,
});
volumeLayer.opacityMultiplier = 0.01;

const xRange = [xMin, xMax] as const;
const yRange = [yMin, yMax] as const;
const zRange = [zMin, zMax] as const;

const camera3D = new PerspectiveCamera({ near: 1.0 });

new Idetik({
  canvas: document.querySelector<HTMLCanvasElement>("#canvas")!,
  viewports: [
    createSliceViewport("slice-xy", "XY", xRange, yRange),
    createSliceViewport("slice-xz", "XZ", xRange, zRange),
    createSliceViewport("slice-yz", "YZ", yRange, zRange),
    new Viewport({
      id: "3d",
      domElement: document.querySelector<HTMLDivElement>("#viewport-3d")!,
      camera: camera3D,
      cameraControls: new OrbitControls(camera3D, {
        radius: Math.hypot(xMax - xMin, yMax - yMin, zMax - zMin),
        yaw: 0.4,
        pitch: 0.1,
        target: center,
      }),
      layers: [
        createSliceLayer("XY"),
        createSliceLayer("XZ"),
        createSliceLayer("YZ"),
        volumeLayer,
      ],
    }),
  ],
  showStats: false,
}).start();

const gui = new GUI({ width: 300 });

addDimensionSlider({
  gui,
  sliceCoords: currentTime,
  dimensionName: "t",
  minValue: 0,
  maxValue: timeCount - 1,
  stepValue: 1,
  playback: {
    maxRateHz: 30,
    stride: 1,
  },
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
