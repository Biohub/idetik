import { mat3, quat, vec3 } from "gl-matrix";

import { Box3 } from "../math/box3";
import { clamp } from "../utilities/clamp";
import { readPlyVertices } from "./ply";

// Two RGBA32UI texels per splat: the center and a scale s (the largest
// standard deviation) as float bits, the Cholesky factor of the covariance
// divided by s as six half floats [L00, L10, L11, L20, L21, L22], and the
// color as RGBA8 with alpha as peak opacity.
export const SPLAT_WORDS = 8;

// Splats extend this many standard deviations, as in the vertex shader.
const EXTENT_SIGMAS = 3;

export type GaussianSplats = {
  count: number;
  data: Uint32Array;
  // Bounds of the centers.
  bounds: Box3;
  // Bounds of the splats' drawn extent, for culling.
  extent: Box3;
};

export type GaussianSplatAttributes = {
  positions: ArrayLike<number>;
  // Standard deviations along each rotated axis.
  scales: ArrayLike<number>;
  // (w, x, y, z) quaternions.
  rotations: ArrayLike<number>;
  // RGBA in [0, 1], alpha is opacity.
  colors: ArrayLike<number>;
};

function toByte(value: number) {
  return Math.round(clamp(value, 0, 1) * 255);
}

export function packGaussianSplats(
  attributes: GaussianSplatAttributes
): GaussianSplats {
  if (typeof Float16Array === "undefined") {
    throw new Error(
      "Gaussian splats require Float16Array support " +
        "(Chrome or Edge 135, Firefox 129, or Safari 18.2 and later)"
    );
  }
  const { positions, scales, rotations, colors } = attributes;
  const count = positions.length / 3;
  const data = new Uint32Array(count * SPLAT_WORDS);
  const floats = new Float32Array(data.buffer);
  const halves = new Float16Array(data.buffer);
  const bounds = new Box3();
  const extent = new Box3();
  const point = vec3.create();
  const rotation = quat.create();
  const m = mat3.create();
  const mT = mat3.create();
  const sigma = mat3.create();

  for (let i = 0; i < count; i++) {
    quat.set(
      rotation,
      rotations[4 * i + 1],
      rotations[4 * i + 2],
      rotations[4 * i + 3],
      rotations[4 * i]
    );
    quat.normalize(rotation, rotation);

    const s = Math.max(
      scales[3 * i],
      scales[3 * i + 1],
      scales[3 * i + 2],
      1e-30
    );
    // M = R · diag(scale) / s, so that Σ / s² = M · Mᵀ.
    mat3.fromQuat(m, rotation);
    for (let col = 0; col < 3; col++) {
      const a = scales[3 * i + col] / s;
      for (let row = 0; row < 3; row++) m[3 * col + row] *= a;
    }
    mat3.multiply(sigma, m, mat3.transpose(mT, m));

    // Σ / s² has entries at most 1, so a fixed floor only guards degenerate
    // (flat) splats.
    const l00 = Math.sqrt(Math.max(sigma[0], 1e-12));
    const l10 = sigma[1] / l00;
    const l20 = sigma[2] / l00;
    const l11 = Math.sqrt(Math.max(sigma[4] - l10 * l10, 1e-12));
    const l21 = (sigma[5] - l20 * l10) / l11;
    const l22 = Math.sqrt(Math.max(sigma[8] - l20 * l20 - l21 * l21, 1e-12));

    const x = positions[3 * i];
    const y = positions[3 * i + 1];
    const z = positions[3 * i + 2];
    const o = i * SPLAT_WORDS;
    floats[o] = x;
    floats[o + 1] = y;
    floats[o + 2] = z;
    floats[o + 3] = s;
    // Words 4-6 hold six halves, low half of each word first.
    const h = 2 * (o + 4);
    halves[h] = l00;
    halves[h + 1] = l10;
    halves[h + 2] = l11;
    halves[h + 3] = l20;
    halves[h + 4] = l21;
    halves[h + 5] = l22;
    data[o + 7] =
      (toByte(colors[4 * i]) |
        (toByte(colors[4 * i + 1]) << 8) |
        (toByte(colors[4 * i + 2]) << 16) |
        (toByte(colors[4 * i + 3]) << 24)) >>>
      0;

    bounds.expandWithPoint(vec3.set(point, x, y, z));
    const r = EXTENT_SIGMAS * s;
    extent.expandWithPoint(vec3.set(point, x - r, y - r, z - r));
    extent.expandWithPoint(vec3.set(point, x + r, y + r, z + r));
  }

  return { count, data, bounds, extent };
}

const PLY_PROPERTIES = [
  "x",
  "y",
  "z",
  "scale_0",
  "scale_1",
  "scale_2",
  "rot_0",
  "rot_1",
  "rot_2",
  "rot_3",
  "f_dc_0",
  "f_dc_1",
  "f_dc_2",
  "opacity",
] as const;

// The degree-0 spherical harmonic basis constant.
const SH_C0 = 0.28209479177387814;

// The layout written by the reference 3D Gaussian Splatting implementation:
// scales are logs, opacity is a logit, and color uses only the degree-0
// spherical harmonic.
export function parseGaussianSplatsPly(buffer: ArrayBuffer) {
  const {
    count,
    properties: p,
    comments,
  } = readPlyVertices(buffer, PLY_PROPERTIES);
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    positions[3 * i] = p.x[i];
    positions[3 * i + 1] = p.y[i];
    positions[3 * i + 2] = p.z[i];
    scales[3 * i] = Math.exp(p.scale_0[i]);
    scales[3 * i + 1] = Math.exp(p.scale_1[i]);
    scales[3 * i + 2] = Math.exp(p.scale_2[i]);
    rotations[4 * i] = p.rot_0[i];
    rotations[4 * i + 1] = p.rot_1[i];
    rotations[4 * i + 2] = p.rot_2[i];
    rotations[4 * i + 3] = p.rot_3[i];
    colors[4 * i] = 0.5 + SH_C0 * p.f_dc_0[i];
    colors[4 * i + 1] = 0.5 + SH_C0 * p.f_dc_1[i];
    colors[4 * i + 2] = 0.5 + SH_C0 * p.f_dc_2[i];
    colors[4 * i + 3] = 1 / (1 + Math.exp(-p.opacity[i]));
  }
  return {
    splats: packGaussianSplats({ positions, scales, rotations, colors }),
    // The PLY layout has no field for this; Postshot records it as a comment.
    antialiased: comments.includes("postshot.anti_aliasing=1"),
  };
}

export async function loadGaussianSplatsPly(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    );
  }
  return parseGaussianSplatsPly(await response.arrayBuffer());
}
