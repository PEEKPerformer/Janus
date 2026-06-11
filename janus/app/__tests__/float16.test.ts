import { f32ToF16Bits, f32ToF16Bytes } from "../float16";

/** Golden vectors from numpy astype(float16).view(uint16) — the exact
 * conversion that produced the Core ML blob layout. */
const F32 = [
  0.0,
  -0.0,
  1.0,
  -1.0,
  0.5,
  65504.0,
  65520.0,
  100000.0,
  -100000.0,
  5.960464477539063e-8,
  2.9802322387695312e-8,
  9.999999717180685e-10,
  -9.999999717180685e-10,
  0.10000000149011612,
  0.20000000298023224,
  0.30000001192092896,
  3.1415927410125732,
  -2.7182817459106445,
  1.0009765625,
  1.0010000467300415,
  2048.5,
  2049.5,
  6.103515625e-5,
  6.103515625e-5,
  1.500000053056283e-7,
  -65504.0,
  0.3333333432674408,
  9.999999680285692e37,
  Infinity,
  -Infinity,
];
const U16 = [
  0, 32768, 15360, 48128, 14336, 31743, 31744, 31744, 64512, 1, 0, 0, 32768,
  11878, 12902, 13517, 16968, 49520, 15361, 15361, 26624, 26625, 1024, 1024, 3,
  64511, 13653, 31744, 31744, 64512,
];

describe("f32ToF16Bits vs numpy goldens", () => {
  it.each(F32.map((v, i) => [v, U16[i]] as const))(
    "%f -> 0x%s",
    (v, expected) => {
      expect(f32ToF16Bits(v)).toBe(expected);
    },
  );

  it("negative zero keeps its sign bit", () => {
    expect(f32ToF16Bits(-0)).toBe(0x8000);
  });
});

describe("f32ToF16Bytes", () => {
  it("emits little-endian fp16, transposing when asked", () => {
    const w = new Float32Array([1, 2, 3, 4, 5, 6]); // 2x3
    const direct = new Uint16Array(f32ToF16Bytes(w, 2, 3, false).buffer);
    const transposed = new Uint16Array(f32ToF16Bytes(w, 2, 3, true).buffer);
    expect(direct[0]).toBe(0x3c00); // 1.0
    expect(direct[1]).toBe(0x4000); // 2.0
    // transpose: [1,4,2,5,3,6]
    expect(transposed[1]).toBe(0x4400); // 4.0
    expect(transposed[2]).toBe(0x4000); // 2.0
  });
});
