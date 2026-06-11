/**
 * Builds a tiny-but-valid .safetensors byte buffer shaped like the Open
 * Pangram checkpoint (RobertaForSequenceClassification), shared by the
 * parser, model-install, and rehydration tests.
 */

export interface FixtureTensor {
  name: string;
  shape: number[];
  dtype?: string;
}

/** Default fixture: hidden size 8, 4 labels, F32 — tiny but structurally real. */
export const PANGRAM_FIXTURE_TENSORS: FixtureTensor[] = [
  { name: "roberta.embeddings.word_embeddings.weight", shape: [10, 8] },
  {
    name: "roberta.encoder.layer.0.attention.self.query.weight",
    shape: [8, 8],
  },
  { name: "classifier.out_proj.weight", shape: [4, 8] },
  { name: "classifier.out_proj.bias", shape: [4] },
];

export function buildSafetensors(
  tensors: FixtureTensor[] = PANGRAM_FIXTURE_TENSORS,
  fill: (tensorIndex: number) => number = (i) => i + 1,
): Uint8Array {
  const header: Record<string, unknown> = {};
  let offset = 0;
  const sizes: number[] = [];
  for (const t of tensors) {
    const bytes = t.shape.reduce((a, b) => a * b, 1) * 4;
    header[t.name] = {
      dtype: t.dtype ?? "F32",
      shape: t.shape,
      data_offsets: [offset, offset + bytes],
    };
    sizes.push(bytes);
    offset += bytes;
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + headerBytes.length + offset);
  new DataView(out.buffer).setUint32(0, headerBytes.length, true);
  out.set(headerBytes, 8);
  let cursor = 8 + headerBytes.length;
  tensors.forEach((_, i) => {
    out.fill(fill(i) & 0xff, cursor, cursor + sizes[i]);
    cursor += sizes[i];
  });
  return out;
}
