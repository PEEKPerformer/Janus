import { f32ToF16Bytes } from "./float16";
import { toFloat32 } from "./quantize";
import type { PangramFs } from "./pangramFs";
import { PANGRAM_FILES } from "./pangramModel";
import type { SafetensorsIndex } from "./safetensors";

/**
 * Build the Core ML .mlpackage on device — rehydration trick #3. The app
 * ships a 0.28MB MLProgram skeleton plus this manifest; the 711MB
 * weights/weight.bin is written here from the user's fp32 checkpoint:
 * header/metadata segments verbatim, then each blob's fp16 payload
 * (transposed where the converter laid it out that way). Validated on the
 * dev Mac: identical verdicts to fp32, 90ms per window on the ANE.
 */

export interface CoreMlBlob {
  dataOffset: number;
  /** fp16 payload size — element count × 2. */
  bytes: number;
  /** Checkpoint tensor name. */
  name: string;
  transposed: boolean;
}

export interface CoreMlManifest {
  version: 3;
  numLabels: number;
  weightBinSize: number;
  packageManifest: unknown;
  /** [offset, base64] — every non-payload byte of weight.bin. */
  headerSegments: [number, string][];
  blobs: CoreMlBlob[];
}

export const COREML_PKG_DIR = "coreml.mlpackage";
export const COREML_MODEL_PATH = `${COREML_PKG_DIR}/Data/com.apple.CoreML/model.mlmodel`;
export const COREML_WEIGHTS_PATH = `${COREML_PKG_DIR}/Data/com.apple.CoreML/weights/weight.bin`;
export const COREML_MANIFEST_PATH = `${COREML_PKG_DIR}/Manifest.json`;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Minimal base64 decoder (Hermes has no reliable global atob). */
export function b64ToBytes(s: string): Uint8Array {
  let len = s.length;
  while (len > 0 && s[len - 1] === "=") len--;
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const v = B64_LOOKUP[s.charCodeAt(i)];
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/**
 * Validate every blob against the checkpoint before any bytes move
 * (the planRehydration discipline, third engine).
 */
export function planCoreMlBuild(
  manifest: CoreMlManifest,
  index: SafetensorsIndex,
): {
  blob: CoreMlBlob;
  srcOffset: number;
  rows: number;
  cols: number;
}[] {
  return manifest.blobs.map((blob) => {
    const entry =
      index.tensors[blob.name] ??
      index.tensors[blob.name.replace(/^roberta\./, "")] ??
      index.tensors[`roberta.${blob.name}`];
    if (!entry)
      throw new Error(`coreml: checkpoint is missing tensor "${blob.name}"`);
    if (entry.dtype !== "F32")
      throw new Error(`coreml: "${blob.name}" is ${entry.dtype}, expected F32`);
    const elements = blob.bytes / 2;
    const srcBytes = entry.offsets[1] - entry.offsets[0];
    if (srcBytes !== elements * 4)
      throw new Error(
        `coreml: "${blob.name}" has ${srcBytes} fp32 bytes for ${elements} fp16 elements`,
      );
    let rows = elements;
    let cols = 1;
    if (entry.shape.length === 2) {
      [rows, cols] = entry.shape;
    } else if (blob.transposed) {
      throw new Error(`coreml: transposed blob "${blob.name}" must be 2D`);
    }
    if (rows * cols !== elements)
      throw new Error(`coreml: shape mismatch for "${blob.name}"`);
    return { blob, srcOffset: index.dataStart + entry.offsets[0], rows, cols };
  });
}

/**
 * Write the whole .mlpackage. `importModelAsset` stages the bundled
 * model.mlmodel into place (expo-asset glue lives with the caller).
 */
export async function buildCoreMlPackage(
  fs: PangramFs,
  manifest: CoreMlManifest,
  index: SafetensorsIndex,
  importModelAsset: (destName: string) => Promise<void>,
  onProgress?: (note: string, fraction: number) => void,
): Promise<void> {
  const plan = planCoreMlBuild(manifest, index);
  await fs.writeText(
    COREML_MANIFEST_PATH,
    JSON.stringify(manifest.packageManifest),
  );
  await importModelAsset(COREML_MODEL_PATH);

  for (const [offset, b64] of manifest.headerSegments)
    await fs.writeBytes(COREML_WEIGHTS_PATH, offset, b64ToBytes(b64));

  const total = plan.reduce((n, p) => n + p.blob.bytes, 0);
  let done = 0;
  for (const p of plan) {
    const raw = await fs.readBytes(
      PANGRAM_FILES.weights,
      p.srcOffset,
      p.rows * p.cols * 4,
    );
    const fp16 = f32ToF16Bytes(
      toFloat32(raw),
      p.rows,
      p.cols,
      p.blob.transposed,
    );
    await fs.writeBytes(COREML_WEIGHTS_PATH, p.blob.dataOffset, fp16);
    done += p.blob.bytes;
    onProgress?.("Building Neural Engine model…", total > 0 ? done / total : 1);
  }

  const size = fs.fileSize(COREML_WEIGHTS_PATH);
  if (size !== manifest.weightBinSize)
    throw new Error(
      `coreml: weight file is ${size ?? 0} bytes, expected ${manifest.weightBinSize}`,
    );
}
