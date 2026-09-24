import { SPLAT_CULL_FLOATS } from "../data/luxar/decode";

const BUCKETS = 1 << 16;

export type SplatCullParams = {
  /** Model-view-projection matrix, column-major. */
  viewProjection: ArrayLike<number>;
  /**
   * The third row of the model-view matrix, which maps a center to its
   * view-space z. Farther splats have more negative z.
   */
  viewZ: ArrayLike<number>;
  /** The projection's x and y scale, `P[0][0]` and `P[1][1]`. */
  projectionScale: [number, number];
  /** Half the viewport size in pixels. */
  halfResolution: [number, number];
  /** Splat extent in standard deviations. */
  truncate: number;
  /** Extra NDC distance outside the viewport before splats are culled. */
  margin: number;
  /** Converts a splat's estimated screen energy to image brightness. */
  contributionScale: number;
  /** Splats contributing less brightness than this are culled. */
  minContribution: number;
  /** Whether to order the survivors back to front. */
  sort: boolean;
};

export type SplatCullScratch = {
  depths: Float32Array;
  indices: Uint32Array;
};

export function createSplatCullScratch(count: number): SplatCullScratch {
  return {
    depths: new Float32Array(count),
    indices: new Uint32Array(count),
  };
}

/**
 * Culls splats outside the view or too faint to see, then optionally orders
 * the survivors back to front with a 16-bit counting sort on view depth.
 *
 * Contribution is estimated conservatively from each splat's largest
 * standard deviation, so the estimate never undercounts a splat.
 *
 * @param cullData - Per-splat cull data, see {@link PackedSplats.cullData}.
 * @param params - The view and culling thresholds.
 * @param out - Receives the surviving splat indices in draw order.
 * @param scratch - Working memory sized for the splat count.
 * @returns The number of surviving splats written to `out`.
 */
export function cullAndSortSplats(
  cullData: Float32Array,
  params: SplatCullParams,
  out: Uint32Array,
  scratch = createSplatCullScratch(cullData.length / SPLAT_CULL_FLOATS)
): number {
  const count = cullData.length / SPLAT_CULL_FLOATS;
  const m = params.viewProjection;
  const [vz0, vz1, vz2, vz3] = [
    params.viewZ[0],
    params.viewZ[1],
    params.viewZ[2],
    params.viewZ[3],
  ];
  const [px, py] = params.projectionScale;
  const [hx, hy] = params.halfResolution;
  const pixelsPerUnit = Math.max(Math.abs(px) * hx, Math.abs(py) * hy);
  const limit = 1 + params.margin;
  const { truncate, contributionScale, minContribution, sort } = params;
  // The ray integral of a unit Gaussian times the area of a unit 2D Gaussian.
  const energyScale = Math.sqrt(2 * Math.PI) * 2 * Math.PI * contributionScale;

  const target = sort ? scratch.indices : out;
  const { depths } = scratch;
  let n = 0;
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * SPLAT_CULL_FLOATS;
    const x = cullData[o];
    const y = cullData[o + 1];
    const z = cullData[o + 2];
    const sigma = cullData[o + 3];
    const amplitude = cullData[o + 4];

    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) continue;
    const invW = 1 / w;
    const extentX = truncate * sigma * Math.abs(px) * invW;
    const extentY = truncate * sigma * Math.abs(py) * invW;
    const ndcX = (m[0] * x + m[4] * y + m[8] * z + m[12]) * invW;
    if (Math.abs(ndcX) - extentX > limit) continue;
    const ndcY = (m[1] * x + m[5] * y + m[9] * z + m[13]) * invW;
    if (Math.abs(ndcY) - extentY > limit) continue;

    const sigmaPixels = sigma * pixelsPerUnit * invW;
    const energy = amplitude * sigma * sigmaPixels * sigmaPixels * energyScale;
    if (energy < minContribution) continue;

    target[n] = i;
    if (sort) {
      const depth = vz0 * x + vz1 * y + vz2 * z + vz3;
      depths[n] = depth;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    }
    n++;
  }
  if (!sort) return n;

  const scale = maxDepth > minDepth ? (BUCKETS - 1) / (maxDepth - minDepth) : 0;
  const counts = new Uint32Array(BUCKETS);
  for (let k = 0; k < n; k++) {
    const key = ((depths[k] - minDepth) * scale) | 0;
    depths[k] = key;
    counts[key]++;
  }
  let offset = 0;
  for (let b = 0; b < BUCKETS; b++) {
    const c = counts[b];
    counts[b] = offset;
    offset += c;
  }
  for (let k = 0; k < n; k++) {
    out[counts[depths[k]]++] = target[k];
  }
  return n;
}
