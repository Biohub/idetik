import { mat4, vec3 } from "gl-matrix";
import GUI from "lil-gui";
import {
  Box3,
  COLORMAP_NAMES,
  ColormapName,
  GaussianSplatLayer,
  Idetik,
  ImageRenderable,
  Layer,
  LuxarGSplatSource,
  OrbitControls,
  PerspectiveCamera,
} from "@";
// Not part of the public API yet.
import { Texture3D } from "@/objects/textures/texture_3d";

// An opaque checkerboard plane at a given z, to show how splats composite
// with occluding content.
class OpaqueSliceLayer extends Layer {
  public readonly type = "OpaqueSliceLayer";
  private readonly image_: ImageRenderable;

  constructor(bounds: Box3, z: number) {
    super({ blendMode: "none" });
    const size = 256;
    const data = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const checker = ((x >> 5) + (y >> 5)) % 2;
        data[y * size + x] = checker ? 110 : 60;
      }
    }
    const width = bounds.max[0] - bounds.min[0];
    const height = bounds.max[1] - bounds.min[1];
    this.image_ = new ImageRenderable({
      width,
      height,
      texture: new Texture3D(data, size, size, 1),
    });
    // The plane geometry spans [0, width] x [0, height] in model space.
    const worldToTexCoord = mat4.fromScaling(mat4.create(), [
      1 / width,
      1 / height,
      0,
    ]);
    this.image_.worldToTexCoord = mat4.translate(
      worldToTexCoord,
      worldToTexCoord,
      [-bounds.min[0], -bounds.min[1], 0]
    );
    this.image_.transform.setTranslation([bounds.min[0], bounds.min[1], z]);
    this.addObject(this.image_);
    this.setState("ready");
  }

  public set z(value: number) {
    const translation = this.image_.transform.translation;
    this.image_.transform.setTranslation([
      translation[0],
      translation[1],
      value,
    ]);
  }

  public update() {}
}

// Zebrafish embryo nuclei (h2afva) over 51 timepoints, fitted as 121M
// Gaussian splats. Lange et al. 2024 (Zebrahub), CC BY 4.0.
// The data host only allows cross-origin requests from luxarviewer.dev, so
// the dev server proxies it.
const dataPath = "/data/2026-09-20/gsplats_4d_h2afva_timelapse.luxar.zarr";
const url = import.meta.env.DEV
  ? `${location.origin}/luxar-data${dataPath}`
  : `https://data.luxarviewer.dev${dataPath}`;

const source = await LuxarGSplatSource.fromHttp({ url });
const defaults = source.renderDefaults;
const time = source.sliceDimensions[0];

const layer = new GaussianSplatLayer({
  source,
  slice: { [time.name]: time.range[0] },
  compositing:
    defaults.blendingMode === "volumetric" ? "volumetric" : "additive",
  opacity: defaults.opacity,
  absorption: defaults.absorption,
  // The store's intensity and offset are tuned for Luxar's HDR target and
  // tone mapping, which clip on idetik's 8-bit canvas.
  intensity: 3,
  offset: 0,
  gamma: defaults.gamma,
  colormap: COLORMAP_NAMES.includes(defaults.colormap as ColormapName)
    ? (defaults.colormap as ColormapName)
    : "plasma",
  amplitudeRange: defaults.amplitudeRange,
  truncationRadius: defaults.truncationRadius,
});

const { min, max } = source.bounds;
const center = vec3.lerp(vec3.create(), min, max, 0.5);
const diagonal = vec3.distance(min, max);

const camera = new PerspectiveCamera({
  near: diagonal * 0.001,
  far: diagonal * 10,
});

const slice = new OpaqueSliceLayer(source.bounds, center[2]);

const idetik = new Idetik({
  canvas: document.querySelector<HTMLCanvasElement>("#canvas")!,
  viewports: [
    {
      camera,
      cameraControls: new OrbitControls(camera, {
        radius: diagonal * 1.2,
        target: center,
      }),
      layers: [slice, layer],
    },
  ],
  showStats: true,
});
idetik.start();

const gui = new GUI({ width: 360, title: "Gaussian splats" });

const status = { splats: "", loading: "" };
gui.add(status, "splats").name("Splats drawn").disable().listen();
gui.add(status, "loading").name("Blocks loading").disable().listen();
setInterval(() => {
  status.splats = `${layer.drawnSplatCount.toLocaleString()} / ${layer.splatCount.toLocaleString()}`;
  status.loading = String(layer.pendingBlocks);
}, 250);

const playback = { time: time.range[0], playing: false, fps: 4 };
const timeController = gui
  .add(playback, "time", time.range[0], time.range[1], time.step ?? 1)
  .name(time.name)
  .onChange((value: number) => (layer.slice = { [time.name]: value }));
gui.add(playback, "playing").name("Play");
gui.add(playback, "fps", 1, 15, 1).name("Playback FPS");

let lastStep = 0;
function tick(timestamp: number) {
  const stepReady = layer.pendingBlocks === 0;
  if (
    playback.playing &&
    stepReady &&
    timestamp - lastStep > 1000 / playback.fps
  ) {
    lastStep = timestamp;
    const step = time.step ?? 1;
    const next =
      playback.time + step > time.range[1]
        ? time.range[0]
        : playback.time + step;
    timeController.setValue(next);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// The top of the range draws every splat in the timepoint.
gui
  .add({ millions: 3 }, "millions", 0.25, 3, 0.25)
  .name("Max splats (M)")
  .onChange((value: number) => {
    layer.maxSplats = value >= 3 ? Infinity : value * 1e6;
  });

const rendering = gui.addFolder("Rendering");
rendering
  .add(layer, "compositing", ["additive", "volumetric"])
  .name("Compositing");
rendering.add(layer, "opacity", 0, 1, 0.01).name("Opacity");
rendering.add(layer, "absorption", 0, 5, 0.01).name("Absorption");
rendering.add(layer, "intensity", 0, 100, 0.1).name("Intensity");
rendering.add(layer, "offset", -1, 1, 0.001).name("Offset");
rendering.add(layer, "gamma", 0.1, 5, 0.01).name("Gamma");
rendering.add(layer, "colormap", COLORMAP_NAMES).name("Colormap");
rendering
  .add(layer.amplitudeRange, "1", 0, layer.amplitudeRange[1] * 4)
  .name("Amplitude max");
rendering.add(layer, "truncationRadius", 1, 4, 0.1).name("Truncation (σ)");

const sliceControls = { visible: true, z: center[2] };
const sliceFolder = gui.addFolder("Opaque slice");
sliceFolder
  .add(sliceControls, "visible")
  .name("Show")
  .onChange((visible: boolean) => {
    const viewport = idetik.viewports[0];
    if (visible) {
      viewport.addLayer(slice);
    } else {
      viewport.removeLayer(slice);
    }
  });
sliceFolder
  .add(sliceControls, "z", min[2], max[2], 1)
  .name("Z")
  .onChange((z: number) => (slice.z = z));
