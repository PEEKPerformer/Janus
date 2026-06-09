/**
 * Live thread mode — the merge logic behind auto-refreshing comments (game
 * threads, megathreads, AMAs). A silent refetch replaces the comment set;
 * anything not seen before is "live-new" and gets the NEW treatment. Pure and
 * source-agnostic: both adapters' comments flow through unchanged.
 */

/** How often live mode refetches. Gentle on both networks' rate limits. */
export const LIVE_REFRESH_MS = 20_000;

/** Ids present in `incoming` that aren't in `known` — the fresh arrivals. */
export function diffNewIds(
  known: ReadonlySet<string>,
  incoming: ReadonlyArray<{ id: string }>,
): string[] {
  const out: string[] = [];
  const dup = new Set<string>();
  for (const c of incoming) {
    if (!known.has(c.id) && !dup.has(c.id)) {
      dup.add(c.id);
      out.push(c.id);
    }
  }
  return out;
}
