import { expect, test } from "vitest";

import { EventContext } from "@/core/event_dispatcher";
import { OrbitControls } from "@/objects/cameras/orbit_controls";
import { PerspectiveCamera } from "@/objects/cameras/perspective_camera";

test("Orbit controls expose their current interaction state", () => {
  const controls = new OrbitControls(new PerspectiveCamera(), {
    radius: 12,
    yaw: 0.4,
    pitch: -0.2,
    target: [1, 2, 3],
  });

  expect(controls.radius).toBe(12);
  expect(controls.yaw).toBe(0.4);
  expect(controls.pitch).toBe(-0.2);
  expect(controls.target).toEqual(new Float32Array([1, 2, 3]));

  controls.target[0] = 99;
  expect(controls.target[0]).toBe(1);
});

function drag(controls: OrbitControls, dx: number, dy: number) {
  const send = (type: "pointerdown" | "pointermove" | "pointerup") =>
    controls.onEvent(
      new EventContext(type, {
        button: 0,
        movementX: dx,
        movementY: dy,
        shiftKey: false,
      } as unknown as PointerEvent)
    );
  send("pointerdown");
  send("pointermove");
  send("pointerup");
  while (controls.isMoving) controls.onUpdate(1 / 60);
}

test("Orbit controls drag over a pole without flipping", () => {
  const camera = new PerspectiveCamera();
  const controls = new OrbitControls(camera, { radius: 5, pitch: 1.4 });
  const right = camera.right;

  drag(controls, 0, 50);
  expect(Math.abs(controls.pitch)).toBeGreaterThan(Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    expect(camera.right[i]).toBeCloseTo(right[i], 5);
  }

  // Upside down, horizontal drags turn yaw the other way so the scene
  // still follows the pointer.
  drag(controls, 10, 0);
  expect(controls.yaw).toBeGreaterThan(0);
});
