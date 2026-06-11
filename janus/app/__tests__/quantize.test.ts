import {
  quantizeTensor,
  roundHalfEven,
  scaleBytes,
  toFloat32,
} from "../quantize";

/**
 * Golden vectors computed by the reference pipeline (numpy float32 division
 * + rint), i.e. exactly what onnxruntime's quantizer produces — the same
 * semantics validated byte-for-byte against ORT on the real checkpoint.
 */
const GOLDEN = [
  {
    w: [127.0, 0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 3.5],
    rows: 2,
    cols: 4,
    transposed: false,
    q: [127, 0, 2, 2, 0, -2, -2, 4],
    scale: 1.0,
  },
  {
    w: [127.0, 0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 3.5],
    rows: 2,
    cols: 4,
    transposed: true,
    q: [127, 0, 0, -2, 2, -2, 2, 4],
    scale: 1.0,
  },
  {
    w: [
      0.06254944950342178, -0.017239682376384735, 0.0012143461499363184,
      0.015078102238476276, -0.029190152883529663, 7.642620039405301e-5,
      -3.29442773363553e-5, -0.06492479890584946, 0.03765334561467171,
      0.02221844531595707, -0.02314087189733982, -0.006347285583615303,
    ],
    rows: 3,
    cols: 4,
    transposed: true,
    q: [122, -57, 74, -34, 0, 43, 2, 0, -45, 29, -127, -12],
    scale: 0.0005112189101055264,
  },
] as {
  w: number[];
  rows: number;
  cols: number;
  transposed: boolean;
  q: number[];
  scale: number;
}[];

describe("roundHalfEven", () => {
  it("banker's rounding, not Math.round", () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(-0.5)).toBe(0);
    expect(roundHalfEven(-1.5)).toBe(-2);
    expect(roundHalfEven(-2.5)).toBe(-2);
    expect(roundHalfEven(1.4999)).toBe(1);
    expect(roundHalfEven(1.5001)).toBe(2);
  });
});

describe("quantizeTensor vs reference golden vectors", () => {
  it.each(GOLDEN.map((g, i) => [i, g] as const))(
    "case %d matches the ORT-validated reference exactly",
    (_i, g) => {
      const { data, scale } = quantizeTensor(
        new Float32Array(g.w),
        g.rows,
        g.cols,
        g.transposed,
      );
      expect(Math.fround(scale)).toBe(Math.fround(g.scale));
      expect(Array.from(data)).toEqual(g.q);
    },
  );

  it("all-zero tensors quantize to zeros with zero scale", () => {
    const { data, scale } = quantizeTensor(new Float32Array(4), 2, 2, false);
    expect(scale).toBe(0);
    expect(Array.from(data)).toEqual([0, 0, 0, 0]);
  });
});

describe("byte helpers", () => {
  it("scaleBytes is little-endian float32", () => {
    const b = scaleBytes(1.0);
    expect(Array.from(b)).toEqual([0, 0, 128, 63]);
  });

  it("toFloat32 handles unaligned views", () => {
    const buf = new Uint8Array(9);
    buf.set(scaleBytes(2.5), 1); // deliberately misaligned
    const f = toFloat32(buf.subarray(1, 5));
    expect(f[0]).toBe(2.5);
  });
});
