import {
  Idetik,
  ImageLayer,
  OmeZarrImageSource,
  OrthographicCamera,
  PanZoomControls,
  Viewport,
} from "idetik";

// A 46000 × 32914 brightfield whole-slide image (OpenSlide's CMU-1 test slide)
// stored as three channels. Drawing them as red, green and blue blends them
// back into the slide's true color.

const DATA_URL = "https://data.idetik.org/examples/openslide-cmu1-pathology";

const source = await OmeZarrImageSource.fromHttp({
  url: `${DATA_URL}/CMU-1.ome.zarr`,
  version: "0.5",
});
const { x, y } = source.getDimensions();
const [xLod, yLod] = [x.lods[0], y.lods[0]];
const extent = {
  left: xLod.translation,
  right: xLod.translation + xLod.scale * xLod.size,
  top: yLod.translation,
  bottom: yLod.translation + yLod.scale * yLod.size,
};

const rgb = () =>
  new ImageLayer({
    source,
    sliceCoords: { c: [0, 1, 2] },
    channelProps: ["#ff0000", "#00ff00", "#0000ff"].map((color) => ({
      color,
      contrastLimits: [0, 255] as [number, number],
    })),
  });

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const camera = new OrthographicCamera(extent);
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: new PanZoomControls(camera),
  layers: [rgb()],
});

// The minimap is a second viewport framed to the whole slide. A viewport
// can't share a layer, so it gets its own; the small viewport only loads the
// coarsest tiles.
const minimapDiv = document.querySelector<HTMLDivElement>("#minimap")!;
const minimapView = document.querySelector<HTMLDivElement>("#minimap-view")!;
const width = extent.right - extent.left;
const height = extent.bottom - extent.top;
minimapDiv.style.aspectRatio = `${width} / ${height}`;
const minimap = new Viewport({
  domElement: minimapDiv,
  camera: new OrthographicCamera(extent),
  layers: [rgb()],
});

const minimapOverlay = {
  update() {
    const { min, max } = camera.getWorldViewRect();
    const left = (Math.min(min[0], max[0]) - extent.left) / width;
    const top = (Math.min(min[1], max[1]) - extent.top) / height;
    const w = Math.abs(max[0] - min[0]) / width;
    const h = Math.abs(max[1] - min[1]) / height;
    // Tolerance for float error in the initial fit-to-slide view.
    const eps = 1e-6;
    const showsWholeSlide =
      left <= eps && top <= eps && left + w >= 1 - eps && top + h >= 1 - eps;
    minimapDiv.style.visibility = showsWholeSlide ? "hidden" : "";
    minimapView.style.left = `${100 * left}%`;
    minimapView.style.top = `${100 * top}%`;
    minimapView.style.width = `${100 * w}%`;
    minimapView.style.height = `${100 * h}%`;
  },
};

// Click or drag in the minimap to center the main view there.
function panTo(e: PointerEvent) {
  if (!(e.buttons & 1)) return;
  const target = minimap.clientToWorld([e.clientX, e.clientY]);
  const { min, max } = camera.getWorldViewRect();
  camera.pan([
    target[0] - (min[0] + max[0]) / 2,
    target[1] - (min[1] + max[1]) / 2,
    0,
  ]);
}
minimapDiv.addEventListener("pointerdown", (e) => {
  minimapDiv.setPointerCapture(e.pointerId);
  panTo(e);
});
minimapDiv.addEventListener("pointermove", panTo);

new Idetik({
  canvas,
  viewports: [viewport, minimap],
  overlays: [minimapOverlay],
}).start();
