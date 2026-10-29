import { afterEach, beforeEach, expect, test } from "vitest";

import { Layer } from "@/core/layer";
import { Viewport } from "@/core/viewport";
import { OrthographicCamera } from "@/objects/cameras/orthographic_camera";
import {
  PointsRenderable,
  PointsRenderableOptions,
} from "@/objects/renderable/points_renderable";
import { WebGLRenderer } from "@/renderers/webgl_renderer";

const SIZE = 128;

class PointLayer extends Layer {
  public readonly type = "PointLayer";

  constructor(public readonly points: PointsRenderable) {
    super();
    this.addObject(points);
    this.setState("ready");
  }

  public update() {
    return true;
  }
}

let canvas: HTMLCanvasElement;
let renderer: WebGLRenderer;
let camera: OrthographicCamera;
let viewport: Viewport;

beforeEach(() => {
  canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.style.width = `${SIZE}px`;
  canvas.style.height = `${SIZE}px`;
  document.body.appendChild(canvas);
  renderer = new WebGLRenderer(canvas);
  // One world unit per pixel.
  camera = new OrthographicCamera({
    left: 0,
    right: SIZE,
    top: SIZE,
    bottom: 0,
  });
  viewport = new Viewport({ id: "points", domElement: canvas, camera });
  viewport.updateSize();
});

afterEach(() => {
  canvas.remove();
});

/** Count pixels close to an RGB color (0-255). */
function countColor(rgb: [number, number, number]) {
  const gl = canvas.getContext("webgl2")!;
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (rgb.every((c, k) => Math.abs(pixels[i + k] - c) < 40)) count++;
  }
  return count;
}

/** Render one red point of `size` at the view center; count red pixels. */
function coveredPixels(size: number, options?: PointsRenderableOptions) {
  const points = new PointsRenderable(
    [
      {
        position: [SIZE / 2, SIZE / 2, 0],
        color: [1, 0, 0],
        size,
        marker: "square",
      },
    ],
    options
  );
  viewport.addLayer(new PointLayer(points));
  renderer.render(viewport);
  return countColor([255, 0, 0]);
}

function zoomIn(factor: number) {
  const half = SIZE / 2 / factor;
  camera.setFrame({
    left: SIZE / 2 - half,
    right: SIZE / 2 + half,
    bottom: SIZE / 2 - half,
    top: SIZE / 2 + half,
  });
}

test("pixel-sized points keep their screen size when zooming", () => {
  zoomIn(2);
  expect(coveredPixels(10)).toBe(100);
});

test("world-sized points cover their world size on screen", () => {
  expect(coveredPixels(10, { sizeUnits: "world" })).toBe(100);
});

test("world-sized points scale with zoom", () => {
  zoomIn(2);
  expect(coveredPixels(10, { sizeUnits: "world" })).toBe(400);
});

test("sizeScale multiplies every point's size", () => {
  expect(coveredPixels(10, { sizeScale: 2 })).toBe(400);
});

test("maxPixelSize clamps world-sized points when zoomed in", () => {
  zoomIn(4);
  expect(coveredPixels(10, { sizeUnits: "world", maxPixelSize: 16 })).toBe(256);
});

test("minPixelSize clamps world-sized points when zoomed out", () => {
  zoomIn(0.25);
  expect(coveredPixels(10, { sizeUnits: "world", minPixelSize: 6 })).toBe(36);
});

test("disposeGeometry frees a rendered geometry's GPU buffers", () => {
  coveredPixels(10);
  const layer = viewport.layers[0] as PointLayer;
  const gl = canvas.getContext("webgl2")!;
  let deleted = 0;
  const deleteBuffer = gl.deleteBuffer.bind(gl);
  gl.deleteBuffer = (buffer) => {
    deleted++;
    deleteBuffer(buffer);
  };
  renderer.disposeGeometry(layer.points.geometry);
  expect(deleted).toBe(1);
  // Disposing again is a no-op; drawing again re-uploads.
  renderer.disposeGeometry(layer.points.geometry);
  expect(deleted).toBe(1);
  renderer.render(viewport);
  renderer.disposeGeometry(layer.points.geometry);
  expect(deleted).toBe(2);
});

/** Red 10 px square at z = 0 (left) and green at z = 10 (right). */
function depthScene() {
  const points = new PointsRenderable([
    {
      position: [SIZE / 4, SIZE / 2, 0],
      color: [1, 0, 0],
      size: 10,
      marker: "square",
    },
    {
      position: [(3 * SIZE) / 4, SIZE / 2, 10],
      color: [0, 1, 0],
      size: 10,
      marker: "square",
    },
  ]);
  viewport.addLayer(new PointLayer(points));
  return points;
}

test("a depth slab draws only the points within it", () => {
  const points = depthScene();
  points.depthSlab = { center: 1, thickness: 4 };
  renderer.render(viewport);
  expect(countColor([255, 0, 0])).toBe(100);
  expect(countColor([0, 255, 0])).toBe(0);

  points.depthSlab = { center: 9, thickness: 4 };
  renderer.render(viewport);
  expect(countColor([255, 0, 0])).toBe(0);
  expect(countColor([0, 255, 0])).toBe(100);

  points.depthSlab = { center: 0, thickness: Infinity };
  renderer.render(viewport);
  expect(countColor([255, 0, 0])).toBe(100);
  expect(countColor([0, 255, 0])).toBe(100);
});

test("a flattened slab draws its points at the slab center", () => {
  // Beyond the camera's far plane, so drawn only when moved to the center.
  const farZ = 2e6;
  const points = new PointsRenderable([
    {
      position: [SIZE / 2, SIZE / 2, farZ],
      color: [1, 0, 0],
      size: 10,
      marker: "square",
    },
  ]);
  viewport.addLayer(new PointLayer(points));
  points.depthSlab = { center: farZ, thickness: Infinity };
  renderer.render(viewport);
  expect(countColor([255, 0, 0])).toBe(0);
  points.depthSlab = { center: 0, thickness: Infinity, flatten: true };
  renderer.render(viewport);
  expect(countColor([255, 0, 0])).toBe(100);
});
