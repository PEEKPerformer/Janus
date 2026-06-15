import {
  detectAi,
  labelsFor,
  softmax,
  textKey,
  verdictSummary,
  DEFAULT_LABELS,
  MAX_WINDOWS,
  MIN_TOKENS,
  type PangramEngine,
} from "../aiLens";
import type { PangramTokenizer } from "../pangramTokenizer";

/** Tokenizer stub: 1 token per word, windows of `windowBody` words. */
const stubTokenizer = (windowBody = 510): PangramTokenizer => ({
  encode: (text) =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((_, i) => 100 + i),
  encodeWindows(text, maxLen = windowBody + 2) {
    const ids = this.encode(text);
    const body = maxLen - 2;
    const out: number[][] = [];
    for (let i = 0; i < ids.length; i += body)
      out.push([0, ...ids.slice(i, i + body), 2]);
    return out;
  },
  bosId: 0,
  eosId: 2,
  padId: 1,
});

const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

const engineOf = (
  logitsPerWindow: number[][],
): PangramEngine & {
  calls: number[][][];
} => {
  const calls: number[][][] = [];
  return {
    calls,
    async classify(windows) {
      calls.push(windows);
      return windows.map((_, i) => logitsPerWindow[i % logitsPerWindow.length]);
    },
  };
};

describe("softmax / labels", () => {
  it("softmax is stable and sums to 1", () => {
    const p = softmax([1000, 1001, 999]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(p[1]).toBeGreaterThan(p[0]);
  });

  it("labelsFor prefers checkpoint labels, falls back to Pangram's scheme", () => {
    expect(labelsFor(2, ["human", "ai"])).toEqual(["human", "ai"]);
    expect(labelsFor(4)).toEqual(DEFAULT_LABELS);
    expect(labelsFor(3)).toEqual(["Level 0", "Level 1", "Level 2"]);
  });
});

describe("detectAi", () => {
  const deps = (engine: PangramEngine, sha = "sha-a") => ({
    tokenizer: stubTokenizer(),
    engine,
    modelSha: sha,
  });

  it("refuses text below MIN_TOKENS", async () => {
    const engine = engineOf([[0, 0, 0, 9]]);
    const res = await detectAi(words(MIN_TOKENS - 1), deps(engine));
    expect(res).toEqual({ kind: "too-short", tokens: MIN_TOKENS - 1 });
    expect(engine.calls).toHaveLength(0);
  });

  it("returns the argmax verdict with calibrated-ish confidence", async () => {
    const engine = engineOf([[0, 0, 0, 6]]); // "fully AI" wins hard
    const res = await detectAi(words(60), deps(engine));
    if (res.kind !== "verdict") throw new Error("expected verdict");
    expect(res.verdict.index).toBe(3);
    expect(res.verdict.label).toBe("Fully AI-generated");
    expect(res.verdict.confidence).toBeGreaterThan(0.9);
    expect(res.verdict.windows).toBe(1);
    expect(verdictSummary(res.verdict)).toMatch(/^Likely fully ai-generated/i);
  });

  it("weights windows by token count and flags an AI-heavy section", async () => {
    // Window 1 (510 tokens): clearly human. Window 2 (90 tokens): clearly AI.
    const engine = engineOf([
      [8, 0, 0, 0],
      [0, 0, 0, 8],
    ]);
    const res = await detectAi(words(600), deps(engine, "sha-b"));
    if (res.kind !== "verdict") throw new Error("expected verdict");
    expect(res.verdict.index).toBe(0); // the long human window dominates
    expect(res.verdict.peakIndex).toBe(3); // …but the AI section surfaces
    expect(verdictSummary(res.verdict)).toMatch(/one section reads more AI/);
  });

  it("caps very long inputs at MAX_WINDOWS and says so", async () => {
    const engine = engineOf([[5, 0, 0, 0]]);
    const res = await detectAi(
      words(510 * (MAX_WINDOWS + 3)),
      deps(engine, "sha-c"),
    );
    if (res.kind !== "verdict") throw new Error("expected verdict");
    expect(res.verdict.windows).toBe(MAX_WINDOWS);
    expect(res.verdict.truncated).toBe(true);
  });

  it("caches by text + model revision — the engine runs once", async () => {
    const engine = engineOf([[0, 5, 0, 0]]);
    const text = words(80);
    const first = await detectAi(text, deps(engine, "sha-d"));
    const second = await detectAi(text, deps(engine, "sha-d"));
    expect(engine.calls).toHaveLength(1);
    expect(second).toEqual(first);
    // Different revision -> different cache namespace.
    await detectAi(text, deps(engine, "sha-e"));
    expect(engine.calls).toHaveLength(2);
  });

  it("textKey separates near-identical texts and revisions", () => {
    expect(textKey("abc", "m1")).not.toBe(textKey("abd", "m1"));
    expect(textKey("abc", "m1")).not.toBe(textKey("abc", "m2"));
    expect(textKey("abc", "m1")).toBe(textKey("abc", "m1"));
  });

  it("textKey ignores surrounding whitespace so trimmed and raw bodies match", () => {
    // The prefetcher trims comment bodies; the thread view reads them raw.
    // Both must resolve to the same cache key or prefetched verdicts vanish.
    expect(textKey("  hello world\n", "m1")).toBe(textKey("hello world", "m1"));
    expect(textKey("\n\ntext\n", "rev")).toBe(textKey("text", "rev"));
  });

  it("rejects malformed engine output", async () => {
    const engine: PangramEngine = { classify: async () => [] };
    await expect(
      detectAi(words(80), {
        tokenizer: stubTokenizer(),
        engine,
        modelSha: "x",
      }),
    ).rejects.toThrow(/malformed/);
  });
});
