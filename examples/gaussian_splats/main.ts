import { vec3 } from "gl-matrix";
import {
  GaussianSplatLayer,
  GaussianSplatSource,
  Idetik,
  OrbitControls,
  PerspectiveCamera,
} from "@";

// Cluster fly by Dany Bittel (https://www.danybittel.ch), licensed CC BY 4.0
// (https://creativecommons.org/licenses/by/4.0/). Originally published at
// https://github.com/danybittel/splats; this is the smallest of its sizes, as
// hosted in the vispy demo data.
const url =
  "https://raw.githubusercontent.com/vispy/demo-data/main/gaussian_splatting/cluster/cluster_fly_S.ply";

const source = await GaussianSplatSource.fromPly(url);
const layer = new GaussianSplatLayer({ source });

const [x, y, z] = source.getDimensions().map((dim) => dim.range);
const center = vec3.fromValues(
  (x[0] + x[1]) / 2,
  (y[0] + y[1]) / 2,
  (z[0] + z[1]) / 2
);
const diagonal = Math.hypot(x[1] - x[0], y[1] - y[0], z[1] - z[0]);

const camera = new PerspectiveCamera({
  near: diagonal * 0.001,
  far: diagonal * 100,
});

const idetik = new Idetik({
  canvas: document.querySelector<HTMLCanvasElement>("#canvas")!,
  viewports: [
    {
      camera,
      cameraControls: new OrbitControls(camera, {
        radius: diagonal * 1.5,
        target: center,
      }),
      layers: [layer],
    },
  ],
  showStats: true,
});
idetik.start();

document.querySelector("#splat-count")!.textContent =
  `${source.splatCount.toLocaleString()} splats`;
