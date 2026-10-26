import { expect, test } from "vitest";

import { Texture3D } from "@/objects/textures/texture_3d";
import { WebGLTextures } from "@/renderers/webgl_textures";

test("A texture bound to several units in a row binds to each of them", () => {
  document.body.innerHTML = `<canvas id="canvas" style="width: 1px; height: 1px"></canvas>`;
  const gl = document
    .querySelector<HTMLCanvasElement>("#canvas")!
    .getContext("webgl2")!;
  const textures = new WebGLTextures(gl);
  const texture = new Texture3D(new Uint8Array(8), 2, 2, 2);
  texture.unpackAlignment = 1;

  textures.bindTexture(texture, 0);
  textures.bindTexture(texture, 1);

  const bound = [0, 1].map((unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    return gl.getParameter(gl.TEXTURE_BINDING_3D);
  });
  expect(bound[0]).not.toBeNull();
  expect(bound[1]).toBe(bound[0]);
});

test("Disposing a texture forgets it on every unit", () => {
  document.body.innerHTML = `<canvas id="canvas" style="width: 1px; height: 1px"></canvas>`;
  const gl = document
    .querySelector<HTMLCanvasElement>("#canvas")!
    .getContext("webgl2")!;
  const textures = new WebGLTextures(gl);
  const texture = new Texture3D(new Uint8Array(8), 2, 2, 2);
  texture.unpackAlignment = 1;

  textures.bindTexture(texture, 2);
  textures.dispose(texture);
  textures.bindTexture(texture, 2);

  gl.activeTexture(gl.TEXTURE2);
  expect(gl.getParameter(gl.TEXTURE_BINDING_3D)).not.toBeNull();
});
