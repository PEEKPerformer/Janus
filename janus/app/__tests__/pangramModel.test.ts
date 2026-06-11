import {
  getPangramState,
  installPangram,
  labelsFromConfig,
  planRehydration,
  recoverPangramState,
  setPangramState,
  uninstallPangram,
  type RehydrationManifest,
} from "../pangramModel";
import { HubError, type HubFetch } from "../pangramHub";
import { parseSafetensorsHeader } from "../safetensors";
import type { PangramFs } from "../pangramFs";
import { buildSafetensors } from "./safetensorsFixture";

const REPO_BODY = {
  sha: "abc1234def",
  siblings: [
    { rfilename: "config.json" },
    { rfilename: "vocab.json" },
    { rfilename: "merges.txt" },
    { rfilename: "model.safetensors" },
  ],
  usedStorage: 999,
};

const okFetch: HubFetch = async () => ({
  status: 200,
  json: async () => REPO_BODY,
  text: async () => "",
});

const CONFIG = JSON.stringify({
  architectures: ["RobertaForSequenceClassification"],
  id2label: { "0": "human", "1": "light", "2": "moderate", "3": "full" },
});

function makeFakeFs() {
  const files = new Map<string, Uint8Array>();
  const copies: {
    src: string;
    dst: string;
    srcOffset: number;
    dstOffset: number;
    bytes: number;
  }[] = [];
  const downloaded: string[] = [];
  const writes: { name: string; offset: number; length: number }[] = [];
  // The real fs grows files as ranges land; model that for fileSize().
  const grown = new Map<string, number>();
  const grow = (name: string, end: number) =>
    grown.set(name, Math.max(grown.get(name) ?? 0, end));
  const fixtures: Record<string, Uint8Array | string> = {
    "config.json": CONFIG,
    "vocab.json": "{}",
    "merges.txt": "",
    "model.safetensors": buildSafetensors(),
  };
  const fs: PangramFs = {
    ensureDir: async () => {},
    path: (n) => `/doc/pangram/${n}`,
    exists: (n) => files.has(n),
    fileSize: (n) => files.get(n)?.length ?? grown.get(n) ?? null,
    readText: async (n) => new TextDecoder().decode(files.get(n)),
    writeText: async (n, text) => {
      files.set(n, new TextEncoder().encode(text));
    },
    readBytes: async (n, offset, length) =>
      files.get(n)!.subarray(offset, offset + length),
    importFile: async () => {},
    copyRange: async (src, dst, srcOffset, dstOffset, bytes) => {
      copies.push({ src, dst, srcOffset, dstOffset, bytes });
      grow(dst, dstOffset + bytes);
    },
    writeBytes: async (name, offset, bytes) => {
      writes.push({ name, offset, length: bytes.length });
      grow(name, offset + bytes.length);
    },
    downloadFile: async (url, name) => {
      downloaded.push(url);
      const v = fixtures[name];
      if (v === undefined) throw new Error(`no fixture for ${name}`);
      files.set(name, typeof v === "string" ? new TextEncoder().encode(v) : v);
    },
    deleteFile: async (n) => void files.delete(n),
    deleteAll: async () => void files.clear(),
  };
  return { fs, files, copies, downloaded, writes };
}

describe("planRehydration (v2: copy + quantize ops)", () => {
  const index = parseSafetensorsHeader(buildSafetensors());
  const embedBytes = 10 * 8 * 4;
  const headElems = 4 * 8;
  const manifest: RehydrationManifest = {
    version: 2,
    numLabels: 4,
    dataTotalBytes: embedBytes + headElems + 4,
    tensors: [
      // Un-prefixed on purpose: exercises the roberta.-prefix tolerance.
      {
        op: "quantize",
        name: "classifier.out_proj.weight",
        transposed: true,
        dstOffset: embedBytes,
        bytes: headElems,
        scaleOffset: embedBytes + headElems,
      },
      {
        op: "copy",
        name: "embeddings.word_embeddings.weight",
        dstOffset: 0,
        bytes: embedBytes,
      },
    ],
  };

  it("maps both op kinds to checkpoint offsets/shapes, sorted by destination", () => {
    const ops = planRehydration(manifest, index);
    expect(ops).toEqual([
      {
        kind: "copy",
        srcOffset: index.dataStart,
        dstOffset: 0,
        bytes: embedBytes,
      },
      {
        kind: "quantize",
        srcOffset: index.dataStart + embedBytes + 8 * 8 * 4,
        rows: 4,
        cols: 8,
        transposed: true,
        dstOffset: embedBytes,
        scaleOffset: embedBytes + headElems,
      },
    ]);
  });

  it("fails loudly on a missing tensor", () => {
    const bad: RehydrationManifest = {
      ...manifest,
      tensors: [{ op: "copy", name: "nope.weight", dstOffset: 0, bytes: 4 }],
    };
    expect(() => planRehydration(bad, index)).toThrow(/missing tensor/);
  });

  it("fails loudly on copy size and quantize element mismatches", () => {
    const badCopy: RehydrationManifest = {
      ...manifest,
      tensors: [
        {
          op: "copy",
          name: "classifier.out_proj.weight",
          dstOffset: 0,
          bytes: 999,
        },
      ],
    };
    expect(() => planRehydration(badCopy, index)).toThrow(/bytes/);
    const badQuant: RehydrationManifest = {
      ...manifest,
      tensors: [
        {
          op: "quantize",
          name: "classifier.out_proj.weight",
          transposed: false,
          dstOffset: 0,
          bytes: headElems + 1,
          scaleOffset: 64,
        },
      ],
    };
    expect(() => planRehydration(badQuant, index)).toThrow(/fp32 bytes/);
  });

  it("refuses non-F32 tensors", () => {
    const f16 = parseSafetensorsHeader(
      buildSafetensors([
        { name: "classifier.out_proj.weight", shape: [4, 8], dtype: "F16" },
      ]),
    );
    expect(() =>
      planRehydration({ ...manifest, tensors: [manifest.tensors[0]] }, f16),
    ).toThrow(/F32/);
  });
});

describe("labelsFromConfig", () => {
  it("orders labels by id", () => {
    expect(labelsFromConfig(CONFIG)).toEqual([
      "human",
      "light",
      "moderate",
      "full",
    ]);
  });
  it("returns null without id2label or on junk", () => {
    expect(labelsFromConfig("{}")).toBeNull();
    expect(labelsFromConfig("not json")).toBeNull();
  });
  it("rejects HF placeholder labels (the real checkpoint ships LABEL_0..3)", () => {
    expect(
      labelsFromConfig(
        JSON.stringify({
          id2label: {
            "0": "LABEL_0",
            "1": "LABEL_1",
            "2": "LABEL_2",
            "3": "LABEL_3",
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("installPangram", () => {
  it("downloads revision-pinned files, verifies, and lands on 'downloaded' without a graph", async () => {
    const { fs, downloaded } = makeFakeFs();
    const state = await installPangram({
      token: "hf_x",
      fs,
      fetchImpl: okFetch,
    });
    expect(state.phase).toBe("downloaded");
    expect(state.sha).toBe("abc1234def");
    expect(state.numLabels).toBe(4);
    expect(state.labels).toEqual(["human", "light", "moderate", "full"]);
    expect(downloaded.every((u) => u.includes("/resolve/abc1234def/"))).toBe(
      true,
    );
    expect(downloaded).toHaveLength(4);
  });

  it("rehydrates to 'ready': copies fp32, quantizes int8 + scale on-device", async () => {
    const { fs, copies, writes } = makeFakeFs();
    const embedBytes = 10 * 8 * 4;
    const headElems = 4 * 8;
    const manifest: RehydrationManifest = {
      version: 2,
      numLabels: 4,
      dataTotalBytes: embedBytes + headElems + 4,
      tensors: [
        {
          op: "copy",
          name: "roberta.embeddings.word_embeddings.weight",
          dstOffset: 0,
          bytes: embedBytes,
        },
        {
          op: "quantize",
          name: "classifier.out_proj.weight",
          transposed: true,
          dstOffset: embedBytes,
          bytes: headElems,
          scaleOffset: embedBytes + headElems,
        },
      ],
    };
    const state = await installPangram({
      token: "hf_x",
      fs,
      fetchImpl: okFetch,
      loadGraph: async () => ({ manifest }),
    });
    expect(state.phase).toBe("ready");
    expect(state.dataBytes).toBe(manifest.dataTotalBytes);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      src: "model.safetensors",
      dst: "pangram_weights.data",
      dstOffset: 0,
      bytes: embedBytes,
    });
    // The quantize op produced int8 data + a 4-byte scale at their offsets.
    expect(writes).toEqual([
      { name: "pangram_weights.data", offset: embedBytes, length: headElems },
      {
        name: "pangram_weights.data",
        offset: embedBytes + headElems,
        length: 4,
      },
    ]);
    // Steady state keeps only the rehydrated data — the 1.4 GB checkpoint
    // is dropped once spliced (the Hub is the durable copy).
    expect(fs.exists("model.safetensors")).toBe(false);
    expect(fs.exists("vocab.json")).toBe(true);
  });

  it("keeps the checkpoint when the graph isn't bundled (finish later)", async () => {
    const { fs } = makeFakeFs();
    await installPangram({ token: "hf_x", fs, fetchImpl: okFetch });
    expect(fs.exists("model.safetensors")).toBe(true);
  });

  it("surfaces the gate as an error state the screen can explain", async () => {
    const { fs } = makeFakeFs();
    const gated: HubFetch = async () => ({
      status: 403,
      json: async () => ({}),
      text: async () => "",
    });
    await expect(
      installPangram({ token: "hf_x", fs, fetchImpl: gated }),
    ).rejects.toBeInstanceOf(HubError);
    expect(getPangramState()).toMatchObject({ phase: "error" });
    expect(getPangramState().error).toMatch(/license/i);
  });

  it("recoverPangramState heals a stale mid-install phase, but never a live one", async () => {
    // Stale: persisted "downloading" with no install running (app was killed).
    setPangramState({ phase: "downloading" });
    expect(recoverPangramState()).toMatchObject({ phase: "error" });
    expect(recoverPangramState().error).toMatch(/interrupted/);

    // Live: recover during an in-flight install must not clobber it.
    const { fs } = makeFakeFs();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowFetch: HubFetch = async () => {
      await gate;
      return { status: 200, json: async () => REPO_BODY, text: async () => "" };
    };
    const installing = installPangram({
      token: "hf_x",
      fs,
      fetchImpl: slowFetch,
    });
    expect(recoverPangramState().phase).toBe("downloading");
    release();
    await installing;
    expect(getPangramState().phase).toBe("downloaded");

    // Steady states are left alone.
    expect(recoverPangramState().phase).toBe("downloaded");
  });

  it("uninstall clears disk and state", async () => {
    const { fs, files } = makeFakeFs();
    await installPangram({ token: "hf_x", fs, fetchImpl: okFetch });
    expect(files.size).toBeGreaterThan(0);
    const state = await uninstallPangram(fs);
    expect(state.phase).toBe("none");
    expect(files.size).toBe(0);
  });
});
