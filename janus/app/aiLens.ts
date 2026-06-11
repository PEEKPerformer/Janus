import { createMMKV } from "react-native-mmkv";

import { PANGRAM_CONTEXT, type PangramTokenizer } from "./pangramTokenizer";

/**
 * AI Lens — on-device "was this written by a model?" verdicts, powered by
 * Open Pangram (EditLens roberta-large) running locally. No text ever leaves
 * the device; it works offline, including inside a plane-mode pack.
 *
 * The classifier emits K logits, one per level of AI pervasiveness. We
 * window long text into 512-token chunks, softmax each window, and report
 * the token-weighted mean distribution — plus the single worst window, so a
 * mostly-human post with one pasted-in AI section still surfaces.
 *
 * Verdicts are probabilistic. The UI copy stays non-accusatory ("likely"),
 * and very short texts are refused outright: under ~50 tokens, even a good
 * detector is a coin toss.
 */

export const MIN_TOKENS = 48;
export const MAX_WINDOWS = 8;

/** Fallback class names (Pangram's published 4-level scheme) when the
 * checkpoint's config.json doesn't carry id2label. */
export const DEFAULT_LABELS = [
  "Human-written",
  "Lightly AI-assisted",
  "Moderately AI-assisted",
  "Fully AI-generated",
];

export interface PangramEngine {
  /** Logits per window; each inner array has numLabels entries. */
  classify(windows: number[][]): Promise<number[][]>;
}

export interface AiVerdict {
  /** Index into labels of the argmax class. */
  index: number;
  label: string;
  /** Token-weighted mean probability per class. */
  probs: number[];
  /** Probability of the winning class (0..1). */
  confidence: number;
  /** Index of the most-AI window's argmax — flags partial pastes. */
  peakIndex: number;
  windows: number;
  tokens: number;
  /** True when input exceeded MAX_WINDOWS and was truncated. */
  truncated: boolean;
}

export type AiLensResult =
  | { kind: "verdict"; verdict: AiVerdict }
  | { kind: "too-short"; tokens: number };

export interface DetectDeps {
  tokenizer: PangramTokenizer;
  engine: PangramEngine;
  labels?: string[];
  /** Cache namespace key — the installed model revision. */
  modelSha?: string;
}

export function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

export function labelsFor(numLabels: number, labels?: string[]): string[] {
  if (labels && labels.length === numLabels) return labels;
  if (numLabels === DEFAULT_LABELS.length) return DEFAULT_LABELS;
  return Array.from({ length: numLabels }, (_, i) => `Level ${i}`);
}

/* Result cache: posts and comments are near-immutable, the model is fixed
 * per revision, and a 355M forward pass isn't free — never compute twice. */
const cache = createMMKV({ id: "janus.aiLens.v1" });

export function textKey(text: string, modelSha = ""): string {
  // FNV-1a x2 with different seeds — cheap, stable, collision-safe enough
  // for a verdict cache (a collision shows a wrong cached verdict, not harm).
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = ((h2 ^ ((c << 1) | 1)) * 0x01000193) >>> 0;
  }
  return `${modelSha.slice(0, 8)}:${h1.toString(36)}${h2.toString(36)}:${text.length}`;
}

export function cachedVerdict(
  text: string,
  modelSha?: string,
): AiVerdict | null {
  try {
    const raw = cache.getString(textKey(text, modelSha));
    return raw ? (JSON.parse(raw) as AiVerdict) : null;
  } catch {
    return null;
  }
}

function storeVerdict(
  text: string,
  modelSha: string | undefined,
  v: AiVerdict,
) {
  try {
    cache.set(textKey(text, modelSha), JSON.stringify(v));
  } catch {
    /* best-effort */
  }
}

export async function detectAi(
  text: string,
  deps: DetectDeps,
): Promise<AiLensResult> {
  const { tokenizer, engine, modelSha } = deps;
  const hit = cachedVerdict(text, modelSha);
  if (hit) return { kind: "verdict", verdict: hit };

  const allWindows = tokenizer.encodeWindows(text, PANGRAM_CONTEXT);
  const tokens = allWindows.reduce((n, w) => n + w.length - 2, 0);
  if (tokens < MIN_TOKENS) return { kind: "too-short", tokens };

  const truncated = allWindows.length > MAX_WINDOWS;
  const windows = truncated ? allWindows.slice(0, MAX_WINDOWS) : allWindows;

  const logits = await engine.classify(windows);
  if (logits.length !== windows.length || logits.some((l) => !l.length))
    throw new Error("AI Lens engine returned malformed logits");

  const numLabels = logits[0].length;
  const labels = labelsFor(numLabels, deps.labels);
  const mean = new Array<number>(numLabels).fill(0);
  let weightTotal = 0;
  let peakIndex = 0;
  let peakScore = -1;
  logits.forEach((l, i) => {
    const probs = softmax(l);
    const weight = windows[i].length - 2;
    weightTotal += weight;
    probs.forEach((p, k) => (mean[k] += p * weight));
    // "most AI" = highest expected pervasiveness level in this window.
    const pervasiveness = probs.reduce((s, p, k) => s + p * k, 0);
    const argmax = probs.indexOf(Math.max(...probs));
    if (pervasiveness > peakScore) {
      peakScore = pervasiveness;
      peakIndex = argmax;
    }
  });
  const probs = mean.map((m) => m / weightTotal);
  const index = probs.indexOf(Math.max(...probs));

  const verdict: AiVerdict = {
    index,
    label: labels[index],
    probs,
    confidence: probs[index],
    peakIndex,
    windows: windows.length,
    tokens,
    truncated,
  };
  storeVerdict(text, modelSha, verdict);
  return { kind: "verdict", verdict };
}

/** One-line, non-accusatory summary for badges and alerts. */
export function verdictSummary(v: AiVerdict): string {
  const pct = Math.round(v.confidence * 100);
  const base = `Likely ${v.label.toLowerCase()} (${pct}%)`;
  return v.peakIndex > v.index
    ? `${base} — one section reads more AI than the rest`
    : base;
}
