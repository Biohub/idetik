import GUI from "lil-gui";
import {
  Idetik,
  ImageLayer,
  LabelLayer,
  OmeZarrImageSource,
  OrthographicCamera,
  Color,
  PanZoomControls,
  Viewport,
} from "@idetik/core";

// A 3D (z-stack) OME-Zarr image with a matching label segmentation overlaid on
// top. The image and labels share the same XY/Z geometry, so a single z-slice
// slider drives both layers.
const imageUrl =
  "https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr";
const labelsUrl = `${imageUrl}/labels/0`;

const imageSource = await OmeZarrImageSource.fromHttp({ url: imageUrl });
const labelsSource = await OmeZarrImageSource.fromHttp({ url: labelsUrl });

const lod = 0;
const dimensions = imageSource.getDimensions();

const zLod = dimensions.z!.lods[lod];
const zTranslation = zLod.translation;
const zScale = zLod.scale;
const zSize = zLod.size;
const zMidIndex = Math.floor((zSize - 1) / 2);
const zMidPoint = zTranslation + zMidIndex * zScale;
const xLod = dimensions.x!.lods[lod];
const xStopPoint = xLod.size * xLod.scale;
const yLod = dimensions.y!.lods[lod];
const yStopPoint = yLod.size * yLod.scale;

const sliceCoords = {
  c: [0, 1],
  z: zMidPoint,
};

const labelsSliceCoords = {
  c: [0],
  z: zMidPoint,
};

const imageLayer = new ImageLayer({
  source: imageSource,
  sliceCoords,
  channelProps: [
    {
      visible: true,
      color: Color.GREEN,
      contrastLimits: [0, 1024],
    },
    {
      visible: true,
      color: Color.MAGENTA,
      contrastLimits: [0, 1024],
    },
  ],
});

const pickInfoEl = document.querySelector<HTMLDivElement>("#pick-info")!;
const controls = {
  zIndex: zMidIndex,
  pickMode: "Fill",
  colorCycle: "Default",
};
let outlineMode = false;

function createLabelsLayer() {
  return new LabelLayer({
    source: labelsSource,
    sliceCoords: labelsSliceCoords,
    opacity: 0.55,
    blendMode: "normal",
    outlineSelected: outlineMode,
    onPickValue: (info) => {
      const { world, value } = info;
      pickInfoEl.innerHTML = `
        World: (${world[0].toFixed(1)}, ${world[1].toFixed(1)}, ${world[2].toFixed(1)})<br/>
        Label: ${value}
      `;
      if (!outlineMode) {
        labelsLayer.setColorMap({
          cycle: Array.from(labelsLayer.colorMap.cycle),
          lookupTable: new Map([[value, Color.WHITE]]),
        });
      }
    },
  });
}

let labelsLayer = createLabelsLayer();

const camera = new OrthographicCamera({
  left: 0,
  right: xStopPoint,
  top: 0,
  bottom: yStopPoint,
});
const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: new PanZoomControls(camera),
  layers: [imageLayer, labelsLayer],
});
const idetik = new Idetik({ canvas, viewports: [viewport] });

function setZIndex(index: number) {
  const z = zTranslation + index * zScale;
  sliceCoords.z = z;
  labelsSliceCoords.z = z;
}

const colorCycles: Record<string, Color[] | undefined> = {
  Default: undefined,
  CMY: [Color.CYAN, Color.MAGENTA, Color.YELLOW],
  RGB: [Color.RED, Color.GREEN, Color.BLUE],
};

function applyColorCycle() {
  const cycle = colorCycles[controls.colorCycle];
  labelsLayer.setColorMap(cycle ? { cycle } : {});
}

const gui = new GUI({ width: 280 });
gui
  .add(controls, "zIndex", 0, zSize - 1, 1)
  .name("Z slice")
  .onChange(setZIndex);
gui
  .add(controls, "pickMode", ["Fill", "Outline"])
  .name("Pick mode")
  .onChange((mode: string) => {
    outlineMode = mode === "Outline";
    viewport.removeLayer(labelsLayer);
    labelsLayer = createLabelsLayer();
    applyColorCycle();
    viewport.addLayer(labelsLayer);
  });
gui
  .add(controls, "colorCycle", Object.keys(colorCycles))
  .name("Color cycle")
  .onChange(applyColorCycle);

idetik.start();
