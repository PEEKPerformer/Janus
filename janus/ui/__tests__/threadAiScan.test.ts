import {
  scanCandidates,
  scanThreadComments,
  THREAD_SCAN_CAP,
} from "../threadAiScan";
import type { Comment } from "../../core/model";
import type { AiLensResult } from "../../app/aiLens";

const c = (
  id: string,
  over: { parentId?: string; score?: number; text?: string } = {},
): Comment =>
  ({
    id,
    parentId: over.parentId,
    score: over.score ?? 0,
    body: { text: over.text ?? `comment ${id}` },
  }) as unknown as Comment;

const verdict = (index: number): AiLensResult => ({
  kind: "verdict",
  verdict: {
    index,
    label: "x",
    probs: [],
    confidence: 0.9,
    peakIndex: index,
    windows: 1,
    tokens: 60,
    truncated: false,
  },
});

describe("scanCandidates", () => {
  it("orders roots by score, then replies, capped", () => {
    const comments = [
      c("r-low", { score: 1 }),
      c("reply-hot", { parentId: "r-low", score: 99 }),
      c("r-high", { score: 50 }),
      c("empty", { score: 80, text: "  " }),
    ];
    expect(scanCandidates(comments).map((x) => x.id)).toEqual([
      "r-high",
      "r-low",
      "reply-hot",
    ]);
    expect(scanCandidates(comments, 2).map((x) => x.id)).toEqual([
      "r-high",
      "r-low",
    ]);
  });

  it("defaults to a bounded budget", () => {
    const many = Array.from({ length: 100 }, (_, i) => c(`c${i}`));
    expect(scanCandidates(many)).toHaveLength(THREAD_SCAN_CAP);
  });
});

describe("scanThreadComments", () => {
  it("judges unjudged comments, skips judged ones, reports progress", async () => {
    const comments = [c("a", { score: 3 }), c("b", { score: 2 }), c("c")];
    const check = jest.fn(async () => verdict(3));
    const seen: [string, AiLensResult][] = [];
    const progress: number[] = [];
    const summary = await scanThreadComments(comments, {
      check,
      onVerdict: (id, res) => seen.push([id, res]),
      alreadyJudged: (id) => id === "b",
      onProgress: (p) => progress.push(p.done),
    });
    expect(summary).toEqual({
      judged: 2,
      tooShort: 0,
      failed: 0,
      cancelled: false,
    });
    expect(check).toHaveBeenCalledTimes(2);
    expect(seen.map(([id]) => id)).toEqual(["a", "c"]);
    expect(progress[progress.length - 1]).toBe(2);
  });

  it("counts too-short refusals separately and survives failures", async () => {
    const comments = [c("a"), c("b"), c("x")];
    const check = jest
      .fn<Promise<AiLensResult>, [string]>()
      .mockResolvedValueOnce({ kind: "too-short", tokens: 5 })
      .mockRejectedValueOnce(new Error("engine hiccup"))
      .mockResolvedValueOnce(verdict(0));
    const summary = await scanThreadComments(comments, {
      check,
      onVerdict: () => {},
      alreadyJudged: () => false,
    });
    expect(summary).toEqual({
      judged: 1,
      tooShort: 1,
      failed: 1,
      cancelled: false,
    });
  });

  it("filters judged comments BEFORE the cap — repeat scans dig deeper", async () => {
    const comments = [
      c("a", { score: 9 }),
      c("b", { score: 8 }),
      c("d", { score: 7 }),
      c("e", { score: 6 }),
    ];
    const judged = new Set(["a", "b"]);
    const seen: string[] = [];
    const summary = await scanThreadComments(comments, {
      check: async () => verdict(0),
      onVerdict: (id) => seen.push(id),
      alreadyJudged: (id) => judged.has(id),
      cap: 2,
    });
    // A top-slice-then-filter would have scanned nothing (a, b already done);
    // the next batch (d, e) gets the budget instead.
    expect(seen).toEqual(["d", "e"]);
    expect(summary.judged).toBe(2);
  });

  it("stops when asked and says so", async () => {
    let calls = 0;
    const summary = await scanThreadComments([c("a"), c("b"), c("d")], {
      check: async () => {
        calls++;
        return verdict(1);
      },
      onVerdict: () => {},
      alreadyJudged: () => false,
      shouldStop: () => calls >= 1,
    });
    expect(summary.cancelled).toBe(true);
    expect(summary.judged).toBe(1);
  });
});
