/**
 * Deterministic per-user colors for comment threads. The same username always
 * hashes to the same hue, so a back-and-forth between two people reads as two
 * consistent colors all the way down the thread — no state, no allocation
 * table, works identically across Reddit and Lemmy.
 *
 * Saturation/lightness are fixed per scheme so every generated color clears
 * readable contrast against the theme background; only the hue varies.
 */

/** FNV-1a 32-bit — tiny, well-distributed for short ASCII names. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Stable display color for a username. Case-insensitive: Reddit usernames are
 * case-preserving but unique case-insensitively, so "Alice" and "alice" are
 * the same person and must get the same color.
 */
export function userColor(username: string, scheme: "light" | "dark"): string {
  const hue = fnv1a(username.toLowerCase()) % 360;
  return scheme === "dark" ? `hsl(${hue}, 60%, 72%)` : `hsl(${hue}, 70%, 34%)`;
}
