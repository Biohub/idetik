import { expect, test } from "vitest";
import { VolumeRenderable } from "@/objects/renderable/volume_renderable";
import { Texture3D } from "@/objects/textures/texture_3d";
import { describeChunk } from "@/data/chunk_content";
import type { Chunk } from "@/data/chunk";

test("contrast culling tracks threshold and visibility changes", () => {
  const data = new Uint16Array([0, 7]);
  const volume = new VolumeRenderable({ channelProps: [{ contrastLimits: [7, 10] }] });
  const chunk: Chunk = {
    texture: new Texture3D(data, 2, 1, 1), chunkIndex: { x: 0, y: 0, z: 0, c: 0, t: 0 },
    content: describeChunk(data, { x: 2, y: 1, z: 1 }),
    state: "loaded", lod: 0, shape: { x: 2, y: 1, z: 1, c: 1 }, rowAlignmentBytes: 2,
    scale: { x: 1, y: 1, z: 1 }, offset: { x: 0, y: 0, z: 0 },
    visible: true, prefetch: false, priority: 0, orderKey: 0,
  };
  volume.updateVolumeWithChunk(chunk);
  expect(volume.hasVisibleContribution).toBe(false);
  volume.setChannelProps([{ contrastLimits: [6, 10] }]);
  expect(volume.hasVisibleContribution).toBe(true);
  volume.setChannelProperty(0, "visible", false);
  expect(volume.hasVisibleContribution).toBe(false);
  volume.reset();
  expect(volume.hasVisibleContribution).toBe(false);
});
