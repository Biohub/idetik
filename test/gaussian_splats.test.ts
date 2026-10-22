import { describe, expect, test, vi } from "vitest";

import { SPLAT_WORDS, packGaussianSplats } from "@/data/gaussian_splats";

// Reconstructs the covariance of splat i from the packed data.
function covariance(data: Uint32Array, i: number) {
  const o = i * SPLAT_WORDS;
  const s = new Float32Array(data.buffer)[o + 3];
  const h = new Float16Array(data.buffer, 4 * (o + 4), 6);
  const L = [
    [h[0], 0, 0],
    [h[1], h[2], 0],
    [h[3], h[4], h[5]],
  ].map((row) => row.map((v) => v * s));
  return L.map((ra) =>
    L.map((rb) => ra[0] * rb[0] + ra[1] * rb[1] + ra[2] * rb[2])
  );
}

describe("packGaussianSplats", () => {
  test("packs centers, colors, bounds, and extent", () => {
    const splats = packGaussianSplats({
      positions: [1, 2, 3, -1, 0, 5],
      scales: [1, 1, 1, 1, 1, 2],
      rotations: [1, 0, 0, 0, 1, 0, 0, 0],
      colors: [1, 0, 0.5, 0.25, 0, 1, 0, 1],
    });
    expect(splats.count).toBe(2);
    const floats = new Float32Array(splats.data.buffer);
    expect(Array.from(floats.subarray(0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(floats.subarray(SPLAT_WORDS, SPLAT_WORDS + 3))).toEqual([
      -1, 0, 5,
    ]);
    expect(Array.from(splats.bounds.min)).toEqual([-1, 0, 3]);
    expect(Array.from(splats.bounds.max)).toEqual([1, 2, 5]);
    // Three standard deviations of each splat's largest scale.
    expect(Array.from(splats.extent.min)).toEqual([-7, -6, -1]);
    expect(Array.from(splats.extent.max)).toEqual([5, 6, 11]);
    const rgba = splats.data[7];
    expect([
      rgba & 255,
      (rgba >> 8) & 255,
      (rgba >> 16) & 255,
      rgba >>> 24,
    ]).toEqual([255, 0, 128, 64]);
  });

  test("builds the covariance from rotated scales", () => {
    // 90 degrees about z maps the x axis to y.
    const q = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const splats = packGaussianSplats({
      positions: [0, 0, 0],
      scales: [3, 1, 2],
      rotations: q,
      colors: [1, 1, 1, 1],
    });
    const cov = covariance(splats.data, 0);
    const expected = [
      [1, 0, 0],
      [0, 9, 0],
      [0, 0, 4],
    ];
    cov.flat().forEach((v, k) => expect(v).toBeCloseTo(expected.flat()[k], 2));
  });

  test("keeps precision for tiny splats", () => {
    // Scene-unit splats are far below half-float range.
    const splats = packGaussianSplats({
      positions: [0, 0, 0],
      scales: [2e-6, 1e-6, 1e-11],
      rotations: [1, 0, 0, 0],
      colors: [1, 1, 1, 1],
    });
    const cov = covariance(splats.data, 0);
    expect(cov[0][0] / 4e-12).toBeCloseTo(1, 2);
    expect(cov[1][1] / 1e-12).toBeCloseTo(1, 2);
    expect(cov[2][2]).toBeLessThan(1e-17);
  });

  test("explains when Float16Array is unavailable", () => {
    vi.stubGlobal("Float16Array", undefined);
    try {
      expect(() =>
        packGaussianSplats({
          positions: [0, 0, 0],
          scales: [1, 1, 1],
          rotations: [1, 0, 0, 0],
          colors: [1, 1, 1, 1],
        })
      ).toThrow("Float16Array");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
