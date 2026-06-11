/**
 * Minimal safetensors reader — header only.
 *
 * The format is simple: 8 bytes little-endian u64 = N, then N bytes of JSON
 * mapping tensor name -> { dtype, shape, data_offsets: [begin, end) } where
 * offsets are relative to the first byte AFTER the header. We never load
 * tensor data here; the parsed index is what the downloader uses to verify a
 * checkpoint and what the rehydrator uses to locate each tensor's bytes.
 */

export interface TensorEntry {
  dtype: string;
  shape: number[];
  /** [begin, end) relative to the data section (header end). */
  offsets: [number, number];
}

export interface SafetensorsIndex {
  /** Byte offset where tensor data begins (8 + header length). */
  dataStart: number;
  tensors: Record<string, TensorEntry>;
}

/** How many bytes of the file we need to parse any sane header. */
export const SAFETENSORS_PROBE_BYTES = 4 * 1024 * 1024;

const MAX_HEADER = 64 * 1024 * 1024;

/**
 * Parse the header from the leading bytes of a .safetensors file. `bytes`
 * must contain at least the full header (SAFETENSORS_PROBE_BYTES is plenty
 * for a 355M-param checkpoint, whose header is ~50KB).
 */
export function parseSafetensorsHeader(bytes: Uint8Array): SafetensorsIndex {
  if (bytes.length < 8) throw new Error("safetensors: file too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lo = view.getUint32(0, true);
  const hi = view.getUint32(4, true);
  if (hi !== 0 || lo > MAX_HEADER)
    throw new Error("safetensors: implausible header length");
  if (bytes.length < 8 + lo)
    throw new Error("safetensors: probe smaller than header — read more bytes");
  const json = utf8Decode(bytes.subarray(8, 8 + lo));
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("safetensors: header is not valid JSON");
  }
  const tensors: Record<string, TensorEntry> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name === "__metadata__") continue;
    const t = value as {
      dtype?: string;
      shape?: number[];
      data_offsets?: [number, number];
    };
    if (
      !t ||
      typeof t.dtype !== "string" ||
      !Array.isArray(t.shape) ||
      !Array.isArray(t.data_offsets) ||
      t.data_offsets.length !== 2 ||
      t.data_offsets[0] > t.data_offsets[1]
    )
      throw new Error(`safetensors: malformed entry for "${name}"`);
    tensors[name] = {
      dtype: t.dtype,
      shape: t.shape,
      offsets: [t.data_offsets[0], t.data_offsets[1]],
    };
  }
  return { dataStart: 8 + lo, tensors };
}

/**
 * Sanity-check that an index looks like the Open Pangram checkpoint —
 * a RobertaForSequenceClassification — and report its label count (the K
 * "AI pervasiveness" levels, read from the classifier head, not assumed).
 */
export function validatePangramCheckpoint(index: SafetensorsIndex): {
  numLabels: number;
  hiddenSize: number;
} {
  const t = index.tensors;
  // HF sometimes prefixes with "roberta." and sometimes not; accept both.
  const pick = (suffix: string): TensorEntry | undefined =>
    t[suffix] ?? t[`roberta.${suffix}`];
  const embed = pick("embeddings.word_embeddings.weight");
  const firstLayer = pick("encoder.layer.0.attention.self.query.weight");
  const head = t["classifier.out_proj.weight"];
  if (!embed || !firstLayer || !head)
    throw new Error(
      "Checkpoint doesn't look like RobertaForSequenceClassification — refusing to install",
    );
  const hiddenSize = embed.shape[1];
  if (head.shape[1] !== hiddenSize)
    throw new Error("Checkpoint classifier head doesn't match hidden size");
  const numLabels = head.shape[0];
  if (numLabels < 2 || numLabels > 16)
    throw new Error(`Checkpoint has an implausible label count (${numLabels})`);
  return { numLabels, hiddenSize };
}

function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined")
    return new TextDecoder("utf-8").decode(bytes);
  // RN's Hermes has TextDecoder; this fallback covers odd test environments.
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) |
          ((bytes[i + 1] & 0x3f) << 6) |
          (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return out;
}
