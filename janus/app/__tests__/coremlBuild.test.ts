import {
  b64ToBytes,
  buildCoreMlPackage,
  planCoreMlBuild,
  COREML_MANIFEST_PATH,
  COREML_MODEL_PATH,
  COREML_WEIGHTS_PATH,
  type CoreMlManifest,
} from "../coremlBuild";
import { parseSafetensorsHeader } from "../safetensors";
import type { PangramFs } from "../pangramFs";
import { buildSafetensors } from "./safetensorsFixture";

const ST = buildSafetensors();
const INDEX = parseSafetensorsHeader(ST);
const HEAD_ELEMS = 4 * 8;
const EMBED_ELEMS = 10 * 8;

const manifest: CoreMlManifest = {
  version: 3,
  numLabels: 4,
  weightBinSize: 64 + EMBED_ELEMS * 2 + HEAD_ELEMS * 2,
  packageManifest: { itemInfoEntries: {} },
  headerSegments: [[0, btoaBytes(new Uint8Array(64).fill(7))]],
  blobs: [
    {
      dataOffset: 64,
      bytes: EMBED_ELEMS * 2,
      name: "roberta.embeddings.word_embeddings.weight",
      transposed: false,
    },
    {
      dataOffset: 64 + EMBED_ELEMS * 2,
      bytes: HEAD_ELEMS * 2,
      name: "classifier.out_proj.weight",
      transposed: true,
    },
  ],
};

function btoaBytes(b: Uint8Array): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += chars[(n >> 18) & 63];
    out += chars[(n >> 12) & 63];
    out += i + 1 < b.length ? chars[(n >> 6) & 63] : "=";
    out += i + 2 < b.length ? chars[n & 63] : "=";
  }
  return out;
}

function fakeFs() {
  const writes: { name: string; offset: number; length: number }[] = [];
  const texts = new Map<string, string>();
  const grown = new Map<string, number>();
  const fs = {
    ensureDir: async () => {},
    path: (n: string) => `/doc/pangram/${n}`,
    exists: () => false,
    fileSize: (n: string) => grown.get(n) ?? null,
    readText: async () => "",
    writeText: async (n: string, t: string) => void texts.set(n, t),
    readBytes: async (_n: string, offset: number, length: number) =>
      ST.subarray(offset, offset + length),
    writeBytes: async (n: string, offset: number, bytes: Uint8Array) => {
      writes.push({ name: n, offset, length: bytes.length });
      grown.set(n, Math.max(grown.get(n) ?? 0, offset + bytes.length));
    },
    copyRange: async () => {},
    importFile: async () => {},
    downloadFile: async () => {},
    deleteFile: async () => {},
    deleteAll: async () => {},
  } as PangramFs;
  return { fs, writes, texts };
}

describe("b64ToBytes", () => {
  it("round-trips binary", () => {
    const data = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect(Array.from(b64ToBytes(btoaBytes(data)))).toEqual(Array.from(data));
  });
});

describe("planCoreMlBuild", () => {
  it("maps blobs to checkpoint offsets and 2D shapes", () => {
    const plan = planCoreMlBuild(manifest, INDEX);
    expect(plan[0]).toMatchObject({
      rows: 10,
      cols: 8,
      srcOffset: INDEX.dataStart,
    });
    expect(plan[1]).toMatchObject({ rows: 4, cols: 8 });
  });

  it("rejects missing tensors and element mismatches", () => {
    expect(() =>
      planCoreMlBuild(
        { ...manifest, blobs: [{ ...manifest.blobs[0], name: "nope" }] },
        INDEX,
      ),
    ).toThrow(/missing tensor/);
    expect(() =>
      planCoreMlBuild(
        { ...manifest, blobs: [{ ...manifest.blobs[0], bytes: 6 }] },
        INDEX,
      ),
    ).toThrow(/fp16 elements/);
  });
});

describe("buildCoreMlPackage", () => {
  it("writes manifest, model, header segments and fp16 payloads, then size-checks", async () => {
    const { fs, writes, texts } = fakeFs();
    const imported: string[] = [];
    await buildCoreMlPackage(fs, manifest, INDEX, async (dest) => {
      imported.push(dest);
    });
    expect(texts.get(COREML_MANIFEST_PATH)).toContain("itemInfoEntries");
    expect(imported).toEqual([COREML_MODEL_PATH]);
    expect(writes).toEqual([
      { name: COREML_WEIGHTS_PATH, offset: 0, length: 64 },
      { name: COREML_WEIGHTS_PATH, offset: 64, length: EMBED_ELEMS * 2 },
      {
        name: COREML_WEIGHTS_PATH,
        offset: 64 + EMBED_ELEMS * 2,
        length: HEAD_ELEMS * 2,
      },
    ]);
  });

  it("fails loudly when the weight file misses its expected size", async () => {
    const { fs } = fakeFs();
    const short = { ...manifest, weightBinSize: manifest.weightBinSize + 1 };
    await expect(
      buildCoreMlPackage(fs, short, INDEX, async () => {}),
    ).rejects.toThrow(/expected/);
  });
});
