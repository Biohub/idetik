import { expect, test } from "vitest";

import { Viewport } from "@/core/viewport";
import { createTestCamera, createTestElement, TrackingLayer } from "./helpers";

function createViewport(id: string, element = createTestElement(id)): Viewport {
  return new Viewport({ id, domElement: element, camera: createTestCamera() });
}

test("Viewport constructor uses the provided ID", () => {
  const viewport = createViewport("custom-viewport");
  expect(viewport.id).toBe("custom-viewport");
});

test("Viewport constructor falls back to the element ID", () => {
  const element = createTestElement("element-id");
  const viewport = new Viewport({
    domElement: element,
    camera: createTestCamera(),
  });
  expect(viewport.id).toBe("element-id");
});

test("Viewport constructor generates an ID when none is provided", () => {
  const element = createTestElement("");
  const viewport = new Viewport({
    domElement: element,
    camera: createTestCamera(),
  });
  expect(viewport.id).not.toBe("");
});

test("Viewport layer mutations do not require a runtime", () => {
  const first = new TrackingLayer();
  const second = new TrackingLayer();
  const viewport = new Viewport({
    domElement: createTestElement(),
    camera: createTestCamera(),
    layers: [first],
  });

  viewport.addLayer(second);
  expect(viewport.layers).toEqual([first, second]);
  expect(first.attachCount).toBe(0);
  expect(second.attachCount).toBe(0);

  viewport.removeLayer(first);
  expect(viewport.layers).toEqual([second]);
  expect(first.detachCount).toBe(0);

  viewport.removeAllLayers();
  expect(viewport.layers).toEqual([]);
  expect(second.detachCount).toBe(0);
});

test("Viewport rejects a layer it already contains", () => {
  const layer = new TrackingLayer();
  expect(
    () =>
      new Viewport({
        id: "dup",
        domElement: createTestElement("dup"),
        camera: createTestCamera(),
        layers: [layer, layer],
      })
  ).toThrow('TrackingLayer is already in viewport "dup".');

  const viewport = createViewport("single");
  viewport.addLayer(layer);
  expect(() => viewport.addLayer(layer)).toThrow(
    'TrackingLayer is already in viewport "single".'
  );
  expect(viewport.layers).toEqual([layer]);
});
