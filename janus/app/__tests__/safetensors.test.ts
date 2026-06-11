import {
  parseSafetensorsHeader,
  validatePangramCheckpoint,
} from "../safetensors";
import {
  buildSafetensors,
  PANGRAM_FIXTURE_TENSORS,
} from "./safetensorsFixture";

describe("parseSafetensorsHeader", () => {
  it("parses names, dtypes, shapes and offsets", () => {
    const index = parseSafetensorsHeader(buildSafetensors());
    const embed = index.tensors["roberta.embeddings.word_embeddings.weight"];
    expect(embed).toMatchObject({ dtype: "F32", shape: [10, 8] });
    expect(embed.offsets).toEqual([0, 10 * 8 * 4]);
    // Data starts right after 8-byte length + JSON header.
    expect(index.dataStart).toBeGreaterThan(8);
  });

  it("ignores __metadata__ and rejects malformed entries", () => {
    const header = JSON.stringify({
      __metadata__: { format: "pt" },
      bad: { dtype: "F32", shape: [1] }, // no data_offsets
    });
    const hb = new TextEncoder().encode(header);
    const buf = new Uint8Array(8 + hb.length);
    new DataView(buf.buffer).setUint32(0, hb.length, true);
    buf.set(hb, 8);
    expect(() => parseSafetensorsHeader(buf)).toThrow(/malformed entry/);
  });

  it("rejects truncated probes and absurd header lengths", () => {
    expect(() => parseSafetensorsHeader(new Uint8Array(4))).toThrow(
      /too short/,
    );
    const huge = new Uint8Array(16);
    new DataView(huge.buffer).setUint32(0, 0xffffffff, true);
    expect(() => parseSafetensorsHeader(huge)).toThrow(/implausible/);
    const bigger = new Uint8Array(16);
    new DataView(bigger.buffer).setUint32(0, 1000, true); // header beyond probe
    expect(() => parseSafetensorsHeader(bigger)).toThrow(/read more bytes/);
  });
});

describe("validatePangramCheckpoint", () => {
  it("accepts the RoBERTa-classifier shape and reads num_labels from the head", () => {
    const index = parseSafetensorsHeader(buildSafetensors());
    expect(validatePangramCheckpoint(index)).toEqual({
      numLabels: 4,
      hiddenSize: 8,
    });
  });

  it("accepts un-prefixed tensor names too", () => {
    const tensors = PANGRAM_FIXTURE_TENSORS.map((t) => ({
      ...t,
      name: t.name.replace(/^roberta\./, ""),
    }));
    const index = parseSafetensorsHeader(buildSafetensors(tensors));
    expect(validatePangramCheckpoint(index).numLabels).toBe(4);
  });

  it("rejects checkpoints that aren't the classifier", () => {
    const index = parseSafetensorsHeader(
      buildSafetensors([{ name: "model.layers.0.mlp.weight", shape: [4, 4] }]),
    );
    expect(() => validatePangramCheckpoint(index)).toThrow(
      /refusing to install/,
    );
  });

  it("rejects a classifier head that doesn't match the hidden size", () => {
    const tensors = PANGRAM_FIXTURE_TENSORS.map((t) =>
      t.name === "classifier.out_proj.weight" ? { ...t, shape: [4, 99] } : t,
    );
    const index = parseSafetensorsHeader(buildSafetensors(tensors));
    expect(() => validatePangramCheckpoint(index)).toThrow(/hidden size/);
  });
});
