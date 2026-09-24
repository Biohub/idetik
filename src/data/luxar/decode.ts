// Decoding for the Luxar gsplats zarr format. See
// https://github.com/royerlab/luxar/blob/main/docs/specs/GSPLATS_ZARR_FORMAT.md

export type LuxarEncoding = {
  name: string;
  [key: string]: unknown;
};

type CodeArray = Uint8Array | Uint16Array;

/**
 * Inverts the `luxar_delta_v1` filter: per-chunk, per-column modular delta +
 * zigzag residuals stored column-major within the chunk.
 */
export function decodeLuxarDelta(
  src: CodeArray,
  cols: number,
  bits: 8 | 16
): CodeArray {
  if (src.length % cols !== 0) {
    throw new Error(
      `luxar_delta_v1: chunk of ${src.length} elements is not a multiple of cols=${cols}`
    );
  }
  const mask = (1 << bits) - 1;
  const rows = src.length / cols;
  const out = new (src.constructor as new (n: number) => CodeArray)(src.length);
  for (let c = 0; c < cols; c++) {
    const base = c * rows;
    let prev = 0;
    for (let r = 0; r < rows; r++) {
      const zz = src[base + r];
      const s = (zz >>> 1) ^ -(zz & 1);
      prev = (prev + s) & mask;
      out[r * cols + c] = prev;
    }
  }
  return out;
}

type NumericArray = ArrayLike<number> & { length: number };

function levelsForBits(bits: unknown, data: NumericArray): number {
  if (bits === 8 || bits === 16) return (1 << bits) - 1;
  return data instanceof Uint8Array ? 255 : 65535;
}

function signedExpm1(y: number) {
  return y < 0 ? -Math.expm1(-y) : Math.expm1(y);
}

const identity = (y: number) => y;

function decodePerChannel(
  data: NumericArray,
  enc: LuxarEncoding,
  cols: number,
  transform: (y: number) => number,
  zeroLevel: boolean
): Float32Array {
  const colLo = enc.col_lo as number[];
  const colHi = enc.col_hi as number[];
  if (colLo.length !== cols || colHi.length !== cols) {
    throw new Error(
      `${enc.name}: expected ${cols} column scales, got ${colLo.length}/${colHi.length}`
    );
  }
  const levels = levelsForBits(enc.bits, data);
  const denom = Math.max(levels - 1, 1);
  const range = colLo.map((lo, c) => Math.max(colHi[c] - lo, 1e-30));
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const u = data[i];
    const c = i % cols;
    if (zeroLevel && u === 0) {
      out[i] = 0;
    } else {
      const y = zeroLevel
        ? colLo[c] + ((u - 1) / denom) * range[c]
        : colLo[c] + (u / levels) * range[c];
      out[i] = transform(y);
    }
  }
  return out;
}

/**
 * Decodes the stored codes of a Luxar array to float32 according to its
 * `encoding` attribute.
 *
 * @param data - The stored values, already passed through the zarr codec
 *   pipeline.
 * @param encoding - The array's `encoding` attribute, if any.
 * @param cols - The size of the trailing (column) dimension, 1 for 1D arrays.
 */
export function decodeLuxarArray(
  data: NumericArray,
  encoding: LuxarEncoding | undefined,
  cols: number
): Float32Array {
  const name = encoding?.name;
  if (encoding === undefined || name === undefined || name === "none") {
    return data instanceof Float32Array ? data : Float32Array.from(data);
  }

  if (name === "broadcasted") {
    const n = encoding.n_elements as number;
    const out = new Float32Array(n * cols);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < cols; c++) out[i * cols + c] = data[c];
    }
    return out;
  }

  if (name === "lut_uint8" || name === "lut_uint16") {
    const lut = (encoding.lut as number[] | number[][]).flat();
    if (encoding.lut_mode === "row") {
      const shape = encoding.original_shape as number[];
      const k = shape[1];
      const out = new Float32Array(data.length * k);
      for (let i = 0; i < data.length; i++) {
        for (let j = 0; j < k; j++) out[i * k + j] = lut[data[i] * k + j];
      }
      return out;
    }
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = lut[data[i]];
    return out;
  }

  if (name.startsWith("bounded_scalar_")) {
    const lo = encoding.min as number;
    const hi = encoding.max as number;
    const scale = (hi - lo) / levelsForBits(encoding.bits, data);
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = lo + data[i] * scale;
    return out;
  }

  if (name.startsWith("log_scalar_")) {
    const scale =
      (encoding.max_log as number) / levelsForBits(encoding.bits, data);
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = Math.expm1(data[i] * scale);
    return out;
  }

  if (name.startsWith("geolog_scalar_")) {
    const lo = encoding.min_log as number;
    const hi = encoding.max_log as number;
    const step =
      Math.max(hi - lo, 0) / (levelsForBits(encoding.bits, data) - 1);
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const u = data[i];
      out[i] = u === 0 ? 0 : Math.exp(lo + (u - 1) * step);
    }
    return out;
  }

  const zeroLevel = encoding.zero_level === true;
  if (name.startsWith("linear_perchannel_")) {
    return decodePerChannel(data, encoding, cols, identity, false);
  }
  if (name.startsWith("log_perchannel_")) {
    return decodePerChannel(data, encoding, cols, Math.expm1, zeroLevel);
  }
  if (name.startsWith("signed_log_perchannel_")) {
    return decodePerChannel(data, encoding, cols, signedExpm1, zeroLevel);
  }
  if (name.startsWith("geolog_perchannel_")) {
    return decodePerChannel(data, encoding, cols, Math.exp, true);
  }

  throw new Error(`Unsupported Luxar array encoding: ${name}`);
}

/**
 * Combines the split Cholesky diagonal and strictly-lower off-diagonal into
 * the packed row-major lower triangle `[L00, L10, L11, L20, L21, L22, ...]`.
 */
export function packCholesky(
  diag: Float32Array,
  offdiag: Float32Array | null,
  count: number,
  ndim: number
): Float32Array {
  const k = (ndim * (ndim + 1)) / 2;
  const nOff = k - ndim;
  const out = new Float32Array(count * k);
  for (let i = 0; i < count; i++) {
    let o = 0;
    let p = i * k;
    for (let r = 0; r < ndim; r++) {
      for (let c = 0; c < r; c++) {
        out[p++] = offdiag ? offdiag[i * nOff + o] : 0;
        o++;
      }
      out[p++] = diag[i * ndim + r];
    }
  }
  return out;
}

// 32-bit words per splat in the packed output: two RGBA32UI texels.
export const PACKED_SPLAT_UINTS = 8;

// Floats per splat in {@link PackedSplats.cullData}.
export const SPLAT_CULL_FLOATS = 5;

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

/** Converts a float to IEEE half-precision bits (round to nearest even). */
export function toHalfBits(value: number): number {
  f32Scratch[0] = value;
  const x = u32Scratch[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;

  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let half = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const midpoint = 1 << (shift - 1);
    if (rem > midpoint || (rem === midpoint && half & 1)) half++;
    return sign | half;
  }
  let half = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  // A carry out of the mantissa correctly rounds up into the exponent.
  if (rem > 0x1000 || (rem === 0x1000 && half & 1)) half++;
  return sign | half;
}

export type SliceGate = {
  /** Column index of the hidden dimension in the stored centers. */
  column: number;
  /** The slice coordinate along the hidden dimension. */
  value: number;
  /**
   * Half-width of the visibility window for discrete dimensions, or `null`
   * for continuous dimensions, which attenuate amplitude by the splat's
   * marginal Gaussian along the dimension instead.
   */
  halfStep: number | null;
};

export type PackOptions = {
  /** Columns of the stored centers mapped to world x, y, and z. */
  worldColumns: [number, number, number];
  /** Hidden dimensions the splats are sliced along. */
  gates: SliceGate[];
  /** Splats attenuated below this amplitude are dropped. */
  minAmplitude?: number;
};

export type PackedSplats = {
  /** Number of splats in {@link data}. */
  count: number;
  /**
   * Eight 32-bit words per splat: the world-space center and amplitude as
   * float bits, then the lower-triangular Cholesky factor of the world-space
   * 3D covariance as six half floats `[L00, L10, L11, L20, L21, L22]`.
   */
  data: Uint32Array;
  /**
   * Per-splat values for culling and sorting, {@link SPLAT_CULL_FLOATS}
   * floats each: the world-space center, the largest standard deviation, and
   * the amplitude.
   */
  cullData: Float32Array;
};

/**
 * Slices nD splats to 3D and packs them for upload.
 *
 * The displayed covariance is the marginal over the world axes. Splats are
 * gated by discrete hidden dimensions and attenuated by continuous ones.
 */
export function packSplats(
  centers: Float32Array,
  amplitudes: Float32Array,
  cholesky: Float32Array,
  count: number,
  ndim: number,
  options: PackOptions
): PackedSplats {
  const { worldColumns, gates } = options;
  const minAmplitude = options.minAmplitude ?? 0;
  const k = (ndim * (ndim + 1)) / 2;
  const data = new Uint32Array(count * PACKED_SPLAT_UINTS);
  const floats = new Float32Array(data.buffer);
  const cullData = new Float32Array(count * SPLAT_CULL_FLOATS);

  // Row offsets into the packed lower triangle.
  const rowStart = new Array<number>(ndim);
  for (let r = 0; r < ndim; r++) rowStart[r] = (r * (r + 1)) / 2;
  const lIndex = (r: number, c: number) => rowStart[r] + c;

  // Covariance entry Σ[a][b] = Σ_j L[a][j] L[b][j] for j <= min(a, b).
  const covariance = (base: number, a: number, b: number) => {
    let sum = 0;
    const m = Math.min(a, b);
    for (let j = 0; j <= m; j++) {
      sum += cholesky[base + lIndex(a, j)] * cholesky[base + lIndex(b, j)];
    }
    return sum;
  };

  const [cx, cy, cz] = worldColumns;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const cBase = i * ndim;
    const lBase = i * k;
    let amplitude = amplitudes[i];
    let visible = true;
    for (const gate of gates) {
      const d = gate.value - centers[cBase + gate.column];
      if (gate.halfStep !== null) {
        if (Math.abs(d) > gate.halfStep) {
          visible = false;
          break;
        }
      } else {
        const variance = covariance(lBase, gate.column, gate.column);
        amplitude *= Math.exp((-0.5 * d * d) / Math.max(variance, 1e-30));
      }
    }
    if (!visible || !(amplitude > minAmplitude)) continue;

    const s00 = covariance(lBase, cx, cx);
    const s10 = covariance(lBase, cy, cx);
    const s11 = covariance(lBase, cy, cy);
    const s20 = covariance(lBase, cz, cx);
    const s21 = covariance(lBase, cz, cy);
    const s22 = covariance(lBase, cz, cz);

    const l00 = Math.sqrt(Math.max(s00, 1e-12));
    const l10 = s10 / l00;
    const l20 = s20 / l00;
    const l11 = Math.sqrt(Math.max(s11 - l10 * l10, 1e-12));
    const l21 = (s21 - l20 * l10) / l11;
    const l22 = Math.sqrt(Math.max(s22 - l20 * l20 - l21 * l21, 1e-12));

    const x = centers[cBase + cx];
    const y = centers[cBase + cy];
    const z = centers[cBase + cz];
    const o = n * PACKED_SPLAT_UINTS;
    floats[o + 0] = x;
    floats[o + 1] = y;
    floats[o + 2] = z;
    floats[o + 3] = amplitude;
    data[o + 4] = toHalfBits(l00) | (toHalfBits(l10) << 16);
    data[o + 5] = toHalfBits(l11) | (toHalfBits(l20) << 16);
    data[o + 6] = toHalfBits(l21) | (toHalfBits(l22) << 16);
    const c = n * SPLAT_CULL_FLOATS;
    cullData[c + 0] = x;
    cullData[c + 1] = y;
    cullData[c + 2] = z;
    cullData[c + 3] = Math.sqrt(Math.max(s00, s11, s22));
    cullData[c + 4] = amplitude;
    n++;
  }

  return {
    count: n,
    data: n === count ? data : data.slice(0, n * PACKED_SPLAT_UINTS),
    cullData: n === count ? cullData : cullData.slice(0, n * SPLAT_CULL_FLOATS),
  };
}
