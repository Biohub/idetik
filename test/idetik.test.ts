import { expect, test, vi } from "vitest";
import { Idetik } from "@/idetik";
import { OrthographicCamera } from "@/objects/cameras/orthographic_camera";
import { PerspectiveCamera } from "@/objects/cameras/perspective_camera";
import { Viewport } from "@/core/viewport";
import {
  createTestCamera,
  createTestElement,
  createTestViewport,
  TrackingLayer,
} from "./helpers";

function createViewport(canvas: HTMLCanvasElement, camera: OrthographicCamera) {
  return new Viewport({ domElement: canvas, camera });
}

test("Runtime start/stop controls the animation loop", () => {
  const canvas = document.createElement("canvas");
  const camera = new OrthographicCamera({
    left: 0,
    right: 128,
    top: 0,
    bottom: 128,
  });
  const idetik = new Idetik({
    canvas,
    viewports: [createViewport(canvas, camera)],
  });

  const rafSpy = vi.spyOn(window, "requestAnimationFrame");
  idetik.start();
  expect(rafSpy).toHaveBeenCalled();

  const cancelRafSpy = vi.spyOn(window, "cancelAnimationFrame");
  idetik.stop();
  expect(cancelRafSpy).toHaveBeenCalled();
});

test("Runtime constructor rejects duplicate viewport IDs before attachment", () => {
  const viewports = [
    new Viewport({
      id: "duplicate",
      domElement: createTestElement("first"),
      camera: createTestCamera(),
    }),
    new Viewport({
      id: "duplicate",
      domElement: createTestElement("second"),
      camera: createTestCamera(),
    }),
  ];

  expect(
    () =>
      new Idetik({
        canvas: document.createElement("canvas"),
        viewports,
      })
  ).toThrow('Duplicate viewport ID "duplicate"');
});

test("addViewport rejects shared elements without changing the runtime", () => {
  const element = createTestElement("shared");
  const first = new Viewport({
    id: "first",
    domElement: element,
    camera: createTestCamera(),
  });
  const idetik = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [first],
  });
  const shared = new Viewport({
    id: "second",
    domElement: element,
    camera: createTestCamera(),
  });

  expect(() => idetik.addViewport(shared)).toThrow(
    "Multiple viewports cannot share the same HTML element"
  );
  expect(idetik.viewports).toEqual([first]);
});

test("Reattaching a viewport refreshes its camera after resizing while inactive", () => {
  const canvas = document.createElement("canvas");
  canvas.style.width = "200px";
  canvas.style.height = "200px";
  document.body.append(canvas);
  try {
    const camera = new PerspectiveCamera();
    const viewport = new Viewport({ domElement: canvas, camera });
    const idetik = new Idetik({ canvas, viewports: [viewport] });
    idetik.removeViewport(viewport);

    canvas.style.width = "400px";
    idetik.addViewport(viewport);

    const projection = camera.projectionMatrix;
    expect(projection[5] / projection[0]).toBeCloseTo(2);
  } finally {
    canvas.remove();
  }
});

test("addViewport rejects shared layers without changing the runtime", () => {
  const layer = new TrackingLayer();
  const first = new Viewport({
    id: "first",
    domElement: createTestElement("first"),
    camera: createTestCamera(),
    layers: [layer],
  });
  const idetik = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [first],
  });
  const shared = new Viewport({
    id: "second",
    domElement: createTestElement("second"),
    camera: createTestCamera(),
    layers: [layer],
  });

  expect(() => idetik.addViewport(shared)).toThrow(
    "TrackingLayer cannot be shared by multiple viewports"
  );
  expect(idetik.viewports).toEqual([first]);
  expect(layer.attachCount).toBe(0);
});

test("Runtime defers layer removal but detaches removed viewports immediately", () => {
  const firstLayer = new TrackingLayer();
  const viewport = new Viewport({
    domElement: createTestElement("first"),
    camera: createTestCamera(),
    layers: [firstLayer],
  });
  const idetik = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [viewport],
  });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });

  idetik.start();
  expect(firstLayer.attachCount).toBe(0);

  frames.shift()!(0);
  expect(firstLayer.attachCount).toBe(1);

  const secondLayer = new TrackingLayer();
  viewport.addLayer(secondLayer);
  expect(secondLayer.attachCount).toBe(0);

  frames.shift()!(16);
  expect(firstLayer.attachCount).toBe(1);
  expect(secondLayer.attachCount).toBe(1);

  viewport.removeLayer(secondLayer);
  expect(secondLayer.detachCount).toBe(0);
  frames.shift()!(32);
  expect(secondLayer.detachCount).toBe(1);
  expect(idetik.removeViewport(viewport)).toBe(true);
  idetik.stop();
  expect(firstLayer.detachCount).toBe(1);
});

test("Runtime rejects layers added to another viewport between frames", () => {
  const layer = new TrackingLayer();
  const first = new Viewport({
    id: "first",
    domElement: createTestElement("first"),
    camera: createTestCamera(),
    layers: [layer],
  });
  const second = new Viewport({
    id: "second",
    domElement: createTestElement("second"),
    camera: createTestCamera(),
  });
  const idetik = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [first, second],
  });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });

  idetik.start();
  frames.shift()!(0);
  second.addLayer(layer);

  expect(() => frames.shift()!(16)).toThrow(
    "TrackingLayer is already attached to another viewport"
  );
  expect(layer.attachCount).toBe(1);
  idetik.stop();
});

test("A stopped runtime retains ownership until it releases the layer", () => {
  const layer = new TrackingLayer();
  const source = new Viewport({
    domElement: createTestElement("source"),
    camera: createTestCamera(),
    layers: [layer],
  });
  const destination = new Viewport({
    domElement: createTestElement("destination"),
    camera: createTestCamera(),
  });
  const a = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [source],
  });
  const b = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [destination],
  });
  let frame: FrameRequestCallback;
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      frame = callback;
      return 1;
    });

  try {
    a.start();
    frame!(0);
    a.stop();
    source.removeLayer(layer);
    destination.addLayer(layer);

    b.start();
    expect(() => frame!(16)).toThrow(/already attached/);
    b.stop();
    b.removeViewport(destination);
    expect(layer.attached).toBe(true);
    expect(layer.detachCount).toBe(0);

    a.start();
    frame!(32);
    a.stop();
    expect(layer.attached).toBe(false);
    expect(layer.detachCount).toBe(1);

    b.addViewport(destination);
    b.start();
    frame!(48);
    expect(layer.attached).toBe(true);
    expect(layer.attachCount).toBe(2);
  } finally {
    if (a.running) a.stop();
    if (b.running) b.stop();
    a.removeViewport(source);
    b.removeViewport(destination);
    raf.mockRestore();
  }
});

test("Inactive viewport removal does not detach the active viewport layer", () => {
  const layer = new TrackingLayer();
  const active = new Viewport({
    id: "active",
    domElement: createTestElement("active"),
    camera: createTestCamera(),
    layers: [layer],
  });
  const inactive = new Viewport({
    id: "inactive",
    domElement: createTestElement("inactive"),
    camera: createTestCamera(),
    layers: [layer],
  });
  const idetik = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [active],
  });
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });

  idetik.start();
  frame!(0);
  inactive.removeLayer(layer);

  expect(layer.attached).toBe(true);
  expect(layer.detachCount).toBe(0);

  idetik.removeViewport(active);
  expect(layer.detachCount).toBe(1);
  idetik.stop();
});

test("Layer transfer succeeds when the destination renders before the source", () => {
  const layer = new TrackingLayer();
  const source = createTestViewport("source");
  const destination = createTestViewport("destination");
  source.addLayer(layer);
  const idetik = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [destination, source],
  });
  let frame: FrameRequestCallback;
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      frame = callback;
      return 1;
    });

  idetik.start();
  try {
    frame!(0);
    source.removeLayer(layer);
    destination.addLayer(layer);

    frame!(16);
    expect(layer.attachCount).toBe(2);
    expect(layer.detachCount).toBe(1);
    expect(layer.attached).toBe(true);
  } finally {
    idetik.removeViewport(destination);
    idetik.removeViewport(source);
    idetik.stop();
    raf.mockRestore();
  }
});

test("Removing a stopped viewport releases layers already removed from its list", () => {
  const layer = new TrackingLayer();
  const viewport = new Viewport({
    domElement: createTestElement(),
    camera: createTestCamera(),
    layers: [layer],
  });
  const idetik = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [viewport],
  });
  let frame: FrameRequestCallback;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });

  idetik.start();
  frame!(0);
  idetik.stop();
  viewport.removeAllLayers();
  expect(layer.attached).toBe(true);
  expect(layer.detachCount).toBe(0);

  idetik.removeViewport(viewport);
  expect(layer.attached).toBe(false);
  expect(layer.detachCount).toBe(1);
});

test("Resize rendering reconciles removed layers before attaching replacements", () => {
  const first = new TrackingLayer();
  const second = new TrackingLayer();
  const viewport = new Viewport({
    domElement: createTestElement(),
    camera: createTestCamera(),
    layers: [first],
  });
  let resize: () => void;
  const observer = vi
    .spyOn(window, "ResizeObserver")
    .mockImplementation(function (callback) {
      resize = () => callback([], {} as ResizeObserver);
      return { observe() {}, unobserve() {}, disconnect() {} };
    });
  const idetik = new Idetik({
    canvas: document.createElement("canvas"),
    viewports: [viewport],
  });
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);

  idetik.start();
  try {
    resize!();
    viewport.removeLayer(first);
    viewport.addLayer(second);
    expect(first.attached).toBe(true);
    expect(second.attached).toBe(false);

    resize!();
    expect(first.attached).toBe(false);
    expect(first.detachCount).toBe(1);
    expect(second.attached).toBe(true);
  } finally {
    idetik.removeViewport(viewport);
    idetik.stop();
    observer.mockRestore();
  }
});
