import type { Post } from "../core/model";

/**
 * Flair browsing — chips over a community feed, built from the flairs on the
 * loaded posts themselves. Data-driven gating: Lemmy posts carry no flair, so
 * the chips simply never appear there; on Reddit they light up wherever the
 * community actually uses flair. No capability flag needed.
 */

export interface FlairChip {
  text: string;
  count: number;
}

/** Distinct post flairs by frequency (then alphabetical), capped. */
export function topFlairs(posts: ReadonlyArray<Post>, max = 12): FlairChip[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const text = p.flair?.text?.trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, max);
}

/** Posts wearing the active flair (null = no filter). */
export function filterByFlair(
  posts: ReadonlyArray<Post>,
  flair: string | null,
): Post[] {
  if (!flair) return [...posts];
  return posts.filter((p) => p.flair?.text?.trim() === flair);
}
