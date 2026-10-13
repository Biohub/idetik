import {
  Idetik,
  ChannelProps,
  OrthographicCamera,
  OmeZarrImageSource,
  PanZoomControls,
  loadOmeroChannels,
  loadOmeroDefaults,
  loadOmeZarrPlate,
  loadOmeZarrWell,
  ImageLayer,
  createNoPrefetchPolicy,
  Viewport,
} from "@";

const plateUrl =
  "https://public.czbiohub.org/organelle_box/datasets/A549/organelle_box_crop_v1.zarr/";
const initialWellPath = "CLTA/PFA";
const initialImagePath = "002000";
const LOW_RES_Z_SCALE = 0.78939; // micrometers per pixel
const HIGH_RES_NUM_SLICES = 38;

const yScale = 0.1028358051168038;
const xScale = 0.10319840632897595;
const ySize = 800;
const xSize = 800;

const plate = await loadOmeZarrPlate(plateUrl);
console.debug("plate", plate);
if (plate.plate === undefined) {
  throw new Error(`No plate found: ${plate}`);
}
const wellPaths = plate.plate.wells.map((well) => well.path);
const wellSelector = document.querySelector("#well") as HTMLSelectElement;
wellPaths.forEach((path) => {
  const option = document.createElement("option");
  option.value = path;
  option.text = path;
  wellSelector.appendChild(option);
  wellSelector.value = initialWellPath;
});

const policy = createNoPrefetchPolicy();

const camera = new OrthographicCamera({
  left: 0,
  right: xSize * xScale,
  top: 0,
  bottom: ySize * yScale,
});

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: new PanZoomControls(camera),
});
const idetik = new Idetik({ canvas, viewports: [viewport] });

idetik.start();

const imageSelector = document.querySelector("#image") as HTMLSelectElement;

const onImageChange = async () => {
  console.debug("onImageChange: ", imageSelector.value);
  viewport.removeAllLayers();
  const imageUrl =
    plateUrl + "/" + wellSelector.value + "/" + imageSelector.value;
  const source = await OmeZarrImageSource.fromHttp({ url: imageUrl });
  const omeroDefaults = await loadOmeroDefaults(source);
  const omeroDefaultZ = omeroDefaults?.defaultZ ?? 0;
  const initZ = (omeroDefaultZ / HIGH_RES_NUM_SLICES) * LOW_RES_Z_SCALE;

  const omeroChannels = await loadOmeroChannels(source);
  const contrastLimits: [number, number][] = [
    [omeroChannels[1].window!.start, omeroChannels[1].window!.end],
    [omeroChannels[2].window!.start, omeroChannels[2].window!.end],
  ];

  const channelProps: ChannelProps[] = [
    { visible: false },
    {
      visible: true,
      color: [0, 1, 1],
      contrastLimits: contrastLimits[0],
    },
    {
      visible: true,
      color: [1, 0, 1],
      contrastLimits: contrastLimits[1],
    },
  ];

  const layer = new ImageLayer({
    source,
    sliceCoords: { t: 0, z: initZ, c: [1, 2] },
    channelProps,
    policy,
  });
  viewport.addLayer(layer);
};

const onWellChange = async () => {
  console.debug("onWellChange: ", wellSelector.value);
  viewport.removeAllLayers();
  const path = wellSelector.value;
  const well = await loadOmeZarrWell(plateUrl, path);
  console.debug("well", well);
  if (well.well === undefined) {
    throw new Error(`No well found: ${well}`);
  }
  const imagePaths = well.well.images.map((image) => image.path);
  imageSelector.innerHTML = "";
  imagePaths.forEach((path) => {
    const option = document.createElement("option");
    option.value = path;
    option.text = path;
    imageSelector.appendChild(option);
    imageSelector.value = initialImagePath;
  });
  await onImageChange();
};

wellSelector.addEventListener("change", onWellChange);
imageSelector.addEventListener("change", onImageChange);

const loadInitialWell = async () => {
  await onWellChange();
};

loadInitialWell();
