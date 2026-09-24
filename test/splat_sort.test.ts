import { expect, test } from "vitest";

import { SplatCullParams, cullAndSortSplats } from "@/utilities/splat_sort";

// [x, y, z, sigma, amplitude] per splat.
function cullData(...splats: number[][]) {
  return new Float32Array(splats.flat());
}

// Identity projection: NDC equals world x, y and w is 1.
const params: SplatCullParams = {
  viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  viewZ: [0, 0, 1, -10],
  projectionScale: [1, 1],
  halfResolution: [100, 100],
  truncate: 3,
  margin: 0,
  contributionScale: 1,
  minContribution: 0,
  sort: true,
};

function run(data: Float32Array, overrides: Partial<SplatCullParams> = {}) {
  const out = new Uint32Array(data.length / 5);
  const count = cullAndSortSplats(data, { ...params, ...overrides }, out);
  return Array.from(out.subarray(0, count));
}

test("orders survivors from most negative view z to least", () => {
  const data = cullData(
    [0, 0, 0.5, 0.01, 1],
    [0, 0, -0.3, 0.01, 1],
    [0, 0, 0.1, 0.01, 1],
    [0, 0, 0.2, 0.01, 1]
  );
  expect(run(data)).toEqual([1, 2, 3, 0]);
});

test("keeps storage order when not sorting", () => {
  const data = cullData([0, 0, 0.5, 0.01, 1], [0, 0, -0.3, 0.01, 1]);
  expect(run(data, { sort: false })).toEqual([0, 1]);
});

test("culls splats whose footprint is outside the viewport", () => {
  const data = cullData(
    [1.5, 0, 0, 0.01, 1], // outside
    [1.02, 0, 0, 0.01, 1], // center outside, footprint overlaps
    [0, -3, 0, 0.01, 1] // outside
  );
  expect(run(data, { sort: false })).toEqual([1]);
  expect(run(data, { sort: false, margin: 1 })).toEqual([0, 1]);
});

test("culls splats behind the camera", () => {
  const behind = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1];
  const data = cullData([0, 0, 0, 0.01, 1]);
  expect(run(data, { viewProjection: behind })).toEqual([]);
});

test("culls splats below the contribution threshold", () => {
  // sigma 0.01 world units is 1 pixel; energy ~ amplitude * 0.01 * 2.5 * 2π.
  const data = cullData([0, 0, 0, 0.01, 1], [0, 0, 0, 0.01, 1e-3]);
  expect(run(data, { sort: false, minContribution: 1e-2 })).toEqual([0]);
});
