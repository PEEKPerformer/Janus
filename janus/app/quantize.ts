/**
 * On-device int8 quantization — the heart of the v2 rehydration. The app
 * ships a quantized GRAPH (no weights, no Pangram IP); the device computes
 * each int8 weight tensor + its scale from the user's downloaded fp32
 * checkpoint. Semantics replicate onnxruntime's dynamic quantizer EXACTLY
 * (validated byte-for-byte against it on the real checkpoint):
 *
 *   scale = fround(amax / 127)                  per-tensor, symmetric
 *   q     = clip(roundHalfEven(fround(w / scale)), -127, 127)
 *
 * Two traps the validation caught, encoded here forever:
 * - the division must happen in FLOAT32 (Math.fround) — float64 division
 *   moves ties and produced 70 single-bit mismatches across the model;
 * - rounding is half-to-EVEN (banker's); Math.round is half-up and differs
 *   exactly on those ties.
 */

export interface QuantizedTensor {
  data: Int8Array;
  scale: number;
}

/** IEEE round-half-to-even, matching numpy's rint. */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Quantize one fp32 matrix (rows×cols, row-major) to int8. When
 * `transposed`, the OUTPUT is the matrix transpose (cols×rows) — the graph
 * stores most MatMul weights pre-transposed.
 */
export function quantizeTensor(
  w: Float32Array,
  rows: number,
  cols: number,
  transposed: boolean,
): QuantizedTensor {
  if (w.length !== rows * cols)
    throw new Error(`quantize: ${w.length} values for ${rows}x${cols}`);
  let amax = 0;
  for (let i = 0; i < w.length; i++) {
    const a = Math.abs(w[i]);
    if (a > amax) amax = a;
  }
  const scale = Math.fround(amax / 127);
  const data = new Int8Array(w.length);
  if (scale === 0) return { data, scale };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const q = roundHalfEven(Math.fround(w[r * cols + c] / scale));
      const v = q > 127 ? 127 : q < -127 ? -127 : q;
      data[transposed ? c * rows + r : r * cols + c] = v;
    }
  }
  return { data, scale };
}

/** Little-endian float32 bytes for a scale value (the data-file encoding). */
export function scaleBytes(scale: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, scale, true);
  return new Uint8Array(buf);
}

/** Interpret raw little-endian bytes as a Float32Array (alignment-safe). */
export function toFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.byteOffset % 4 === 0 && bytes.byteLength % 4 === 0)
    return new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 4,
    );
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}
