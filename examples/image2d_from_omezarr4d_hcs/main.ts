import GUI from "lil-gui";
import {
  ChannelProps,
  Idetik,
  ImageLayer,
  OmeZarrImageSource,
  OrthographicCamera,
  PanZoomControls,
  Viewport,
  createNoPrefetchPolicy,
  loadOmeroChannels,
  loadOmeZarrPlate,
  loadOmeZarrWell,
} from "idetik";
import { addDimensionSlider } from "../lil_gui_utils";

// A 60-well plate browsed in three levels, each a set of viewports on one
// canvas: the plate as a grid of one field per well at the coarsest
// resolution, a well as its nine fields, and a single field with pan, zoom
// and a z slider.
const plateUrl =
  "https://public.czbiohub.org/organelle_box/datasets/A549/organelle_box_crop_v1.zarr";

const plate = await loadOmeZarrPlate(plateUrl);
if (plate.plate === undefined) throw new Error("No plate found");
const wellPaths = plate.plate.wells.map((well) => well.path);

const wellFields = new Map<string, string[]>();
await Promise.all(
  wellPaths.map(async (wellPath) => {
    const well = await loadOmeZarrWell(plateUrl, wellPath);
    if (well.well === undefined) throw new Error(`No well at ${wellPath}`);
    wellFields.set(
      wellPath,
      well.well.images.map((image) => image.path)
    );
  })
);

// Display windows vary by orders of magnitude between wells, so each field
// takes its channel colors and windows from its own omero metadata.
type Field = { source: OmeZarrImageSource; channelProps: ChannelProps[] };
const fields = new Map<string, Promise<Field>>();
function openField(wellPath: string, fieldPath: string): Promise<Field> {
  const key = `${wellPath}/${fieldPath}`;
  let field = fields.get(key);
  if (!field) {
    field = OmeZarrImageSource.fromHttp({ url: `${plateUrl}/${key}` }).then(
      async (source) => {
        const omero = await loadOmeroChannels(source);
        const fromOmero = (index: number): ChannelProps => ({
          visible: true,
          color: `#${omero[index].color}`,
          contrastLimits: [
            omero[index].window!.start,
            omero[index].window!.end,
          ],
        });
        return {
          source,
          channelProps: [{ visible: false }, fromOmero(1), fromOmero(2)],
        };
      }
    );
    fields.set(key, field);
  }
  return field;
}

// Every field has the same shape, so one image's dimensions frame them all.
const { source: firstSource } = await openField(
  wellPaths[0],
  wellFields.get(wellPaths[0])![0]
);
const dims = firstSource.getDimensions();
const xLod = dims.x.lods[0];
const yLod = dims.y.lods[0];
const zLod = dims.z!.lods[0];
const frame = {
  left: xLod.translation,
  right: xLod.translation + xLod.size * xLod.scale,
  top: yLod.translation,
  bottom: yLod.translation + yLod.size * yLod.scale,
};
const midZ = zLod.translation + Math.floor((zLod.size - 1) / 2) * zLod.scale;

// Tiles are pinned to the coarsest level and never prefetch, so the plate
// costs one chunk per channel per well.
const coarsestPolicy = createNoPrefetchPolicy({
  lod: { min: Number.MAX_SAFE_INTEGER },
});
const tilePolicy = createNoPrefetchPolicy();
const tileSliceCoords = { t: 0, z: midZ, c: [1, 2] };

type Level = "plate" | "well" | "field";
const containers: Record<Level, HTMLDivElement> = {
  plate: document.querySelector<HTMLDivElement>("#plate-grid")!,
  well: document.querySelector<HTMLDivElement>("#well-grid")!,
  field: document.querySelector<HTMLDivElement>("#field-view")!,
};
const breadcrumb = document.querySelector<HTMLDivElement>("#breadcrumb")!;

function createTile(
  container: HTMLDivElement,
  label: string,
  onClick: () => void
): HTMLDivElement {
  const tile = document.createElement("div");
  tile.className = "tile";
  const span = document.createElement("span");
  span.className = "label";
  span.textContent = label;
  tile.append(span);
  tile.addEventListener("click", onClick);
  container.append(tile);
  return tile;
}

function createTileViewport(
  tile: HTMLDivElement,
  field: Promise<Field>,
  policy: ReturnType<typeof createNoPrefetchPolicy>
): Viewport {
  const viewport = new Viewport({
    domElement: tile,
    camera: new OrthographicCamera(frame),
  });
  void field.then(({ source, channelProps }) => {
    viewport.addLayer(
      new ImageLayer({
        source,
        sliceCoords: tileSliceCoords,
        channelProps,
        policy,
      })
    );
  });
  return viewport;
}

const plateViewports = wellPaths.map((wellPath) => {
  const tile = createTile(containers.plate, wellPath.replace("/", " · "), () =>
    showWell(wellPath)
  );
  const field = wellFields.get(wellPath)![0];
  return createTileViewport(tile, openField(wellPath, field), coarsestPolicy);
});

const fieldCamera = new OrthographicCamera(frame);
const fieldViewport = new Viewport({
  domElement: containers.field,
  camera: fieldCamera,
  cameraControls: new PanZoomControls(fieldCamera),
});
const fieldSliceCoords = { t: 0, z: midZ, c: [1, 2] };

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const idetik = new Idetik({
  canvas,
  viewports: plateViewports,
  maxConcurrentRequests: 16,
});
idetik.start();

const gui = new GUI({ width: 280 }).hide();
addDimensionSlider({
  gui,
  sliceCoords: fieldSliceCoords,
  dimensionName: "z",
  lod: zLod,
});

let activeViewports: Viewport[] = plateViewports;
function setLevel(level: Level, viewports: Viewport[], crumbs: Crumb[]) {
  for (const [name, container] of Object.entries(containers)) {
    container.classList.toggle("hidden", name !== level);
  }
  for (const viewport of activeViewports) idetik.removeViewport(viewport);
  for (const viewport of viewports) idetik.addViewport(viewport);
  activeViewports = viewports;
  if (level === "field") gui.show();
  else gui.hide();
  renderBreadcrumb(crumbs);
}

type Crumb = { label: string; onClick?: () => void };
function renderBreadcrumb(crumbs: Crumb[]) {
  breadcrumb.replaceChildren();
  crumbs.forEach((crumb, index) => {
    if (index > 0) breadcrumb.append(" › ");
    const span = document.createElement("span");
    span.textContent = crumb.label;
    if (crumb.onClick) {
      span.className = "link";
      span.addEventListener("click", crumb.onClick);
    }
    breadcrumb.append(span);
  });
}

function showPlate() {
  setLevel("plate", plateViewports, [{ label: "Plate" }]);
}

function showWell(wellPath: string) {
  containers.well.replaceChildren();
  const wellViewports = wellFields.get(wellPath)!.map((field) => {
    const tile = createTile(containers.well, field, () =>
      showField(wellPath, field)
    );
    return createTileViewport(tile, openField(wellPath, field), tilePolicy);
  });
  setLevel("well", wellViewports, [
    { label: "Plate", onClick: showPlate },
    { label: wellPath },
  ]);
}

async function showField(wellPath: string, field: string) {
  fieldViewport.removeAllLayers();
  fieldCamera.setFrame(frame);
  setLevel(
    "field",
    [fieldViewport],
    [
      { label: "Plate", onClick: showPlate },
      { label: wellPath, onClick: () => showWell(wellPath) },
      { label: field },
    ]
  );
  const { source, channelProps } = await openField(wellPath, field);
  fieldViewport.addLayer(
    new ImageLayer({ source, sliceCoords: fieldSliceCoords, channelProps })
  );
}

showPlate();
