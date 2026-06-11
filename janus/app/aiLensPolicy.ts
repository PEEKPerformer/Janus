import { createMMKV } from "react-native-mmkv";

import type { AiVerdict } from "./aiLens";

/**
 * AI Lens display policy — what happens to content once it's been judged.
 * The detector only ever *labels*; what the label does is the user's call,
 * set per verdict level (a policy ladder, not a hide switch):
 *
 *   none      nothing shown
 *   label     a quiet chip next to the comment's badges (default)
 *   dim       chip + the body renders faded
 *   collapse  the body folds into a one-line stub with the reason — tap to show
 *   hide      a minimal hairline stub — still one tap to reveal, never silent
 *
 * Confidence floor: an uncertain verdict (argmax below CONFIDENCE_FLOOR)
 * never escalates past "label" — auto-folding a human's comment on a coin
 * toss is the failure mode this whole design exists to avoid.
 */

export type AiTreatment = "none" | "label" | "dim" | "collapse" | "hide";

export const AI_TREATMENTS: AiTreatment[] = [
  "none",
  "label",
  "dim",
  "collapse",
  "hide",
];

/** Verdict levels above human that carry a policy (indexes into probs). */
export type AiLevelKey = "light" | "moderate" | "full";

export interface AiLensPolicy {
  light: AiTreatment;
  moderate: AiTreatment;
  full: AiTreatment;
}

export const DEFAULT_AI_POLICY: AiLensPolicy = {
  light: "label",
  moderate: "label",
  full: "label",
};

export const CONFIDENCE_FLOOR = 0.6;

const store = createMMKV({ id: "janus.aiLensPolicy.v1" });
const KEY = "policy";

export function getAiLensPolicy(): AiLensPolicy {
  try {
    const raw = store.getString(KEY);
    if (!raw) return { ...DEFAULT_AI_POLICY };
    const parsed = JSON.parse(raw) as Partial<AiLensPolicy>;
    const valid = (t: unknown): t is AiTreatment =>
      AI_TREATMENTS.includes(t as AiTreatment);
    return {
      light: valid(parsed.light) ? parsed.light : DEFAULT_AI_POLICY.light,
      moderate: valid(parsed.moderate)
        ? parsed.moderate
        : DEFAULT_AI_POLICY.moderate,
      full: valid(parsed.full) ? parsed.full : DEFAULT_AI_POLICY.full,
    };
  } catch {
    return { ...DEFAULT_AI_POLICY };
  }
}

export function setAiLensPolicy(patch: Partial<AiLensPolicy>): AiLensPolicy {
  const next = { ...getAiLensPolicy(), ...patch };
  try {
    store.set(KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
  return next;
}

export function levelKeyFor(index: number): AiLevelKey | null {
  return index === 1
    ? "light"
    : index === 2
      ? "moderate"
      : index >= 3
        ? "full"
        : null;
}

/**
 * The effective treatment for a verdict under a policy. Human verdicts get
 * nothing; low-confidence verdicts are capped at "label".
 */
export function treatmentFor(
  verdict: Pick<AiVerdict, "index" | "confidence">,
  policy: AiLensPolicy,
): AiTreatment {
  const key = levelKeyFor(verdict.index);
  if (!key) return "none";
  const chosen = policy[key];
  if (chosen === "none" || chosen === "label") return chosen;
  return verdict.confidence >= CONFIDENCE_FLOOR ? chosen : "label";
}

/** Chip text per level — short, lowercase-calm, non-accusatory. */
export function chipLabelFor(index: number): string | null {
  return index === 1
    ? "lightly AI"
    : index === 2
      ? "AI-assisted"
      : index >= 3
        ? "AI-written"
        : null;
}

/** Chip/stub accent per level (amber → red-orange ramp). */
export function chipColorFor(index: number): string {
  return index >= 3 ? "#e05d44" : index === 2 ? "#d99a2b" : "#8a8a93";
}
