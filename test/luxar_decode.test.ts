import { describe, expect, test } from "vitest";

import {
  PACKED_SPLAT_UINTS,
  decodeLuxarArray,
  decodeLuxarDelta,
  packCholesky,
  packSplats,
  toHalfBits,
} from "@/data/luxar/decode";

// Mirrors the encoder in the Luxar spec.
function encodeDelta(codes: number[], cols: number, bits: 8 | 16) {
  const mask = (1 << bits) - 1;
  const half = (mask >>> 1) + 1;
  const rows = codes.length / cols;
  const out =
    bits === 8 ? new Uint8Array(codes.length) : new Uint16Array(codes.length);
  for (let c = 0; c < cols; c++) {
    let prev = 0;
    for (let r = 0; r < rows; r++) {
      const code = codes[r * cols + c];
      const d = (code - prev) & mask;
      const s = d >= half ? d - (mask + 1) : d;
      out[c * rows + r] = ((s << 1) ^ (s >> 31)) & mask;
      prev = code;
    }
  }
  return out;
}

function halfToFloat(bits: number) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

describe("decodeLuxarDelta", () => {
  test("round trips the spec encoder with wrap-around", () => {
    const codes = [0, 65535, 10, 1, 65000, 3, 7, 2];
    const encoded = encodeDelta(codes, 2, 16);
    expect(Array.from(decodeLuxarDelta(encoded, 2, 16))).toEqual(codes);
  });

  test("decodes 8-bit columns", () => {
    const codes = [255, 0, 1, 128, 3, 250];
    const encoded = encodeDelta(codes, 3, 8);
    expect(Array.from(decodeLuxarDelta(encoded, 3, 8))).toEqual(codes);
  });
});

describe("decodeLuxarArray", () => {
  test("linear per-channel spans each column's range", () => {
    const data = new Uint16Array([0, 65535, 65535, 0]);
    const out = decodeLuxarArray(
      data,
      {
        name: "linear_perchannel_u16",
        col_lo: [1, -2],
        col_hi: [3, 2],
        bits: 16,
      },
      2
    );
    expect(Array.from(out)).toEqual([1, 2, 3, -2]);
  });

  test("log per-channel reserves code 0 for zero", () => {
    const data = new Uint8Array([0, 1, 255]);
    const out = decodeLuxarArray(
      data,
      {
        name: "log_perchannel_u8",
        col_lo: [0.5],
        col_hi: [1.5],
        bits: 8,
        zero_level: true,
      },
      1
    );
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(Math.expm1(0.5), 6);
    expect(out[2]).toBeCloseTo(Math.expm1(1.5), 6);
  });

  test("signed log per-channel preserves sign", () => {
    const data = new Uint8Array([1, 255]);
    const out = decodeLuxarArray(
      data,
      {
        name: "signed_log_perchannel_u8",
        col_lo: [-1],
        col_hi: [1],
        bits: 8,
        zero_level: true,
      },
      1
    );
    expect(out[0]).toBeCloseTo(-Math.expm1(1), 6);
    expect(out[1]).toBeCloseTo(Math.expm1(1), 6);
  });

  test("scalar encodings", () => {
    expect(
      Array.from(
        decodeLuxarArray(
          new Uint8Array([0, 255]),
          { name: "bounded_scalar_uint8", min: 2, max: 4 },
          1
        )
      )
    ).toEqual([2, 4]);
    const geolog = decodeLuxarArray(
      new Uint16Array([0, 1, 65535]),
      { name: "geolog_scalar_uint16", min_log: -2, max_log: 1, bits: 16 },
      1
    );
    expect(geolog[0]).toBe(0);
    expect(geolog[1]).toBeCloseTo(Math.exp(-2), 6);
    expect(geolog[2]).toBeCloseTo(Math.exp(1), 5);
    expect(
      Array.from(
        decodeLuxarArray(
          new Uint8Array([2, 0]),
          { name: "lut_uint8", lut: [0.5, 1.5, 2.5] },
          1
        )
      )
    ).toEqual([2.5, 0.5]);
  });

  test("broadcasted expands to n elements", () => {
    const out = decodeLuxarArray(
      new Float32Array([1, 2]),
      { name: "broadcasted", n_elements: 3 },
      2
    );
    expect(Array.from(out)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  test("rejects unknown encodings", () => {
    expect(() =>
      decodeLuxarArray(new Uint8Array(1), { name: "mystery" }, 1)
    ).toThrow();
  });
});

describe("toHalfBits", () => {
  test.each([0, 1, -2.5, 0.1, 3.14159, 65504, 1e-5, 6e-8])(
    "round trips %f",
    (v) => {
      expect(Math.abs(halfToFloat(toHalfBits(v)) - v)).toBeLessThanOrEqual(
        Math.max(Math.abs(v) * 2 ** -11, 2 ** -25)
      );
    }
  );

  test("overflows to infinity", () => {
    expect(halfToFloat(toHalfBits(1e6))).toBe(Infinity);
  });
});

describe("packSplats", () => {
  // One 4D splat with dims (z, y, x, t) and an axis-aligned covariance.
  const centers = new Float32Array([30, 20, 10, 5]);
  const amplitudes = new Float32Array([0.5]);
  const diag = new Float32Array([3, 2, 1, 1e-7]);
  const cholesky = packCholesky(diag, new Float32Array(6), 1, 4);
  const worldColumns: [number, number, number] = [2, 1, 0];

  test("reorders to world axes and takes the marginal factor", () => {
    const packed = packSplats(centers, amplitudes, cholesky, 1, 4, {
      worldColumns,
      gates: [],
    });
    expect(packed.count).toBe(1);
    expect(Array.from(packed.cullData)).toEqual([10, 20, 30, 3, 0.5]);
    const floats = new Float32Array(packed.data.buffer);
    expect(floats[3]).toBe(0.5);
    const halves = [4, 5, 6].flatMap((i) => [
      halfToFloat(packed.data[i] & 0xffff),
      halfToFloat(packed.data[i] >>> 16),
    ]);
    // [L00, L10, L11, L20, L21, L22] in (x, y, z) order.
    expect(halves).toEqual([1, 0, 2, 0, 0, 3]);
    expect(packed.data.length).toBe(PACKED_SPLAT_UINTS);
  });

  test("gates discrete hidden dimensions", () => {
    const pack = (value: number) =>
      packSplats(centers, amplitudes, cholesky, 1, 4, {
        worldColumns,
        gates: [{ column: 3, value, halfStep: 0.5 }],
      }).count;
    expect(pack(5)).toBe(1);
    expect(pack(6)).toBe(0);
  });

  test("attenuates continuous hidden dimensions", () => {
    const wide = packCholesky(
      new Float32Array([3, 2, 1, 2]),
      new Float32Array(6),
      1,
      4
    );
    const packed = packSplats(centers, amplitudes, wide, 1, 4, {
      worldColumns,
      gates: [{ column: 3, value: 7, halfStep: null }],
    });
    const floats = new Float32Array(packed.data.buffer);
    expect(floats[3]).toBeCloseTo(0.5 * Math.exp(-0.5), 6);
  });

  test("marginalizes correlated covariance", () => {
    // 2x2 spatial correlation between z and y in a 3D splat.
    const c = new Float32Array([0, 0, 0]);
    const l = new Float32Array([1, 0.5, 2, 0, 0, 1]); // rows z, y, x
    const packed = packSplats(c, new Float32Array([1]), l, 1, 3, {
      worldColumns: [2, 1, 0],
      gates: [],
    });
    const h = [4, 5, 6].flatMap((i) => [
      halfToFloat(packed.data[i] & 0xffff),
      halfToFloat(packed.data[i] >>> 16),
    ]);
    const L = [
      [h[0], 0, 0],
      [h[1], h[2], 0],
      [h[3], h[4], h[5]],
    ];
    const cov = (a: number, b: number) =>
      L[a][0] * L[b][0] + L[a][1] * L[b][1] + L[a][2] * L[b][2];
    // World (x, y, z) covariance: var(x)=1, var(y)=0.25+4, var(z)=1, cov(y,z)=0.5.
    expect(cov(0, 0)).toBeCloseTo(1, 3);
    expect(cov(1, 1)).toBeCloseTo(4.25, 2);
    expect(cov(2, 2)).toBeCloseTo(1, 3);
    expect(cov(2, 1)).toBeCloseTo(0.5, 3);
    expect(cov(1, 0)).toBeCloseTo(0, 3);
  });
});
