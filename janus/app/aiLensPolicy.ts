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

/**
 * Automatic judging: off (manual + scans only), posts (judge the post body
 * when a thread opens), threads (posts + an automatic comment scan), or
 * ahead (all of that, plus feed-time prefetching: post bodies and the top
 * comments of the most-commented threads are judged BEFORE you open them,
 * so verdicts come from cache). Everything lands in the verdict cache, so
 * re-visits cost nothing.
 */
export type AiAutoMode = "off" | "posts" | "threads" | "ahead";

export const AI_AUTO_MODES: AiAutoMode[] = ["off", "posts", "threads", "ahead"];

/** Comments judged per manual scan-pill tap. */
export const SCAN_CAP_OPTIONS = [15, 30, 60];
/** Comments judged per automatic scan (thread open). */
export const AUTO_CAP_OPTIONS = [6, 12, 24];

export interface AiLensPolicy {
  light: AiTreatment;
  moderate: AiTreatment;
  full: AiTreatment;
  auto: AiAutoMode;
  scanCap: number;
  autoCap: number;
  /** Feed cards show a "judging…" chip while their check is queued. */
  showActivity: boolean;
  /** Judged-human content gets a quiet green chip (vs unmarked = unjudged). */
  showHuman: boolean;
}

export const DEFAULT_AI_POLICY: AiLensPolicy = {
  light: "label",
  moderate: "label",
  full: "label",
  // Checking everything IS the product ("see it's AI before you tap") —
  // and costs ~63ms/check on the ANE. CPU fallbacks stay safe through
  // pacing/caps, not through a timid default.
  auto: "ahead",
  scanCap: 30,
  autoCap: 12,
  showActivity: true,
  // On by default: a detector you rely on must mark what it judged human (and
  // too-short), so a clean comment reliably means "not judged yet" rather than
  // an ambiguous "human, or never checked". Opt out in Settings if you only
  // ever want the AI flags.
  showHuman: true,
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
      auto: AI_AUTO_MODES.includes(parsed.auto as AiAutoMode)
        ? (parsed.auto as AiAutoMode)
        : DEFAULT_AI_POLICY.auto,
      scanCap: SCAN_CAP_OPTIONS.includes(parsed.scanCap as number)
        ? (parsed.scanCap as number)
        : DEFAULT_AI_POLICY.scanCap,
      autoCap: AUTO_CAP_OPTIONS.includes(parsed.autoCap as number)
        ? (parsed.autoCap as number)
        : DEFAULT_AI_POLICY.autoCap,
      showActivity:
        typeof parsed.showActivity === "boolean"
          ? parsed.showActivity
          : DEFAULT_AI_POLICY.showActivity,
      showHuman:
        typeof parsed.showHuman === "boolean"
          ? parsed.showHuman
          : DEFAULT_AI_POLICY.showHuman,
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

/**
 * One-time migration: "Flag humans too" shipped opt-OUT-shaped (default off),
 * so judged-human and too-short comments were invisible — a "clean" comment was
 * ambiguous between "human" and "never checked". Flip existing installs on once
 * to match the new default; a deliberate opt-out from Settings sticks (it sets
 * the migration flag too, so this never overrides it).
 */
export function migrateAiLensPolicy(): void {
  try {
    if (store.getString("humanFlagDefaultedOn") === "1") return;
    store.set("humanFlagDefaultedOn", "1");
    const raw = store.getString(KEY);
    // No persisted policy → the new default (true) already applies. A persisted
    // one predates the new default, so flip it on.
    if (raw) setAiLensPolicy({ showHuman: true });
  } catch {
    /* best-effort */
  }
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
  policy: Pick<AiLensPolicy, AiLevelKey>,
): AiTreatment {
  const key = levelKeyFor(verdict.index);
  if (!key) return "none";
  const chosen = policy[key];
  if (chosen === "none" || chosen === "label") return chosen;
  return verdict.confidence >= CONFIDENCE_FLOOR ? chosen : "label";
}

/**
 * One-shot upgrade to the real default: the first time the Neural Engine
 * proves itself on this device, auto mode bumps to "ahead" — including
 * installs that picked a lower tier back when checks cost seconds. Strictly
 * once: any choice made AFTER the bump (e.g. turning it down) sticks
 * forever.
 */
export function maybeDefaultAutoForAne(): AiLensPolicy {
  const current = getAiLensPolicy();
  try {
    if (store.getString("aneAutoApplied2") === "1") return current;
    store.set("aneAutoApplied2", "1");
  } catch {
    return current;
  }
  if (current.auto === "ahead") return current;
  return setAiLensPolicy({ auto: "ahead" });
}

/** Chip text per level — short, lowercase-calm, non-accusatory. Humans are
 * unmarked unless the user opts into the green "human" chip. */
export function chipLabelFor(index: number, showHuman = false): string | null {
  if (index === 0) return showHuman ? "human" : null;
  return index === 1
    ? "lightly AI"
    : index === 2
      ? "AI-assisted"
      : index >= 3
        ? "AI-written"
        : null;
}

/** Chip/stub accent per level (calm green → amber → red-orange ramp). */
export function chipColorFor(index: number): string {
  if (index === 0) return "#5bb98c";
  return index >= 3 ? "#e05d44" : index === 2 ? "#d99a2b" : "#8a8a93";
}
