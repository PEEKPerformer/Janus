import { createMMKV } from "react-native-mmkv";

import type { AiLensResult } from "./aiLens";
import { engineBackend } from "./pangramEngine";

/**
 * The settings-screen speed test: time one near-full window and one
 * comment-sized check, record which execution provider actually ran them.
 * Salted text defeats the verdict cache (a cached "benchmark" measures a
 * map lookup), and the result persists so the Ready card can always answer
 * "running on what, how fast?" — the go/no-go data for int8 quantization.
 */

export interface BenchResult {
  backend: string | null;
  /** One ~480-token window (the worst case a long post pays). */
  fullMs: number;
  /** One comment-sized check (~80 tokens → 128 bucket). */
  shortMs: number;
  at: number;
}

const store = createMMKV({ id: "janus.aiLensBench.v1" });
const KEY = "last";

const FILLER =
  "the committee reviewed seventeen separate proposals before lunch and rejected " +
  "eleven of them for reasons ranging from budget overruns to scheduling conflicts " +
  "with the annual maintenance window that nobody remembered approving ";

export function lastBench(): BenchResult | null {
  try {
    const raw = store.getString(KEY);
    return raw ? (JSON.parse(raw) as BenchResult) : null;
  } catch {
    return null;
  }
}

export async function runAiBench(
  check: (text: string) => Promise<AiLensResult>,
  opts: { now?: () => number; salt?: string } = {},
): Promise<BenchResult> {
  const now = opts.now ?? Date.now;
  const salt = opts.salt ?? String(now());
  // ~360 filler words ≈ 470 tokens — one window, no truncation.
  const fullText = `Speed test ${salt}. ${FILLER.repeat(12)}`;
  // Two FILLERs ≈ 80 tokens — comfortably past the detector's 48-token
  // refusal floor (one FILLER is ~44 tokens, which measured nothing but a
  // refused check — the infamous "1ms typical comment").
  const shortText = `Quick check ${salt}. ${FILLER.repeat(2)}`;

  const t0 = now();
  await check(fullText);
  const t1 = now();
  await check(shortText);
  const t2 = now();

  const result: BenchResult = {
    backend: engineBackend(),
    fullMs: t1 - t0,
    shortMs: t2 - t1,
    at: now(),
  };
  try {
    store.set(KEY, JSON.stringify(result));
  } catch {
    /* best-effort */
  }
  return result;
}

/** One-line summary for the Ready card. */
export function benchSummary(b: BenchResult): string {
  const s = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  return `${b.backend ?? "engine"} · ${s(b.fullMs)} full window · ${s(b.shortMs)} typical comment`;
}
