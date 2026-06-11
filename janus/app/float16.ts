/**
 * float32 -> float16 conversion (IEEE 754 round-to-nearest-even), used to
 * build the Core ML weight file from the user's fp32 checkpoint. Hermes has
 * no Float16Array, so this is the bit algorithm — golden-tested against
 * numpy's astype(float16), which is what produced the blob layout the
 * manifest was matched against.
 */

const f32buf = new Float32Array(1);
const u32buf = new Uint32Array(f32buf.buffer);

/** One float32 value -> float16 bits (uint16). */
export function f32ToF16Bits(value: number): number {
  f32buf[0] = value;
  const x = u32buf[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;

  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // inf / nan
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // overflow -> inf
  if (e <= 0) {
    // Subnormal half (or zero): shift the 24-bit significand down.
    if (e < -10) return sign; // underflow to signed zero
    const m = mant | 0x800000;
    const shift = 14 - e;
    let half = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && (half & 1) === 1)) half++;
    return sign | half;
  }
  let half = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  // Round to nearest even; a carry out of the mantissa correctly bumps the
  // exponent (and saturates to inf at the top) by construction.
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1) === 1)) half++;
  return sign | half;
}

/**
 * Convert a rows×cols float32 matrix to little-endian float16 bytes,
 * transposing when asked (the manifest's blob layout).
 */
export function f32ToF16Bytes(
  w: Float32Array,
  rows: number,
  cols: number,
  transposed: boolean,
): Uint8Array {
  if (w.length !== rows * cols)
    throw new Error(`f16: ${w.length} values for ${rows}x${cols}`);
  const out = new Uint16Array(w.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[transposed ? c * rows + r : r * cols + c] = f32ToF16Bits(
        w[r * cols + c],
      );
    }
  }
  return new Uint8Array(out.buffer); // typed arrays are LE on all RN targets
}
