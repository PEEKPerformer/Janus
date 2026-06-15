import type { AiVerdict } from "../app/aiLens";

/**
 * Coarsen a verdict's confidence into a content-free bucket for analytics, so
 * the fleet shows the spread of how sure the detector is without ever sending
 * a raw probability tied to a specific (unsent) piece of text.
 */
export function confidenceBucket(v: Pick<AiVerdict, "confidence">): string {
  const c = v.confidence;
  if (c < 0.6) return "<60";
  if (c < 0.8) return "60-80";
  if (c < 0.95) return "80-95";
  return "95+";
}
