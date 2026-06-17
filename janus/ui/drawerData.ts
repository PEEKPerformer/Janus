/**
 * The "reddit/lemmy harmony" logic behind the community drawer.
 *
 * The drawer lists the communities you follow ACROSS every account — Reddit and
 * each Lemmy instance — as ONE merged, alphabetised list rather than segregated
 * source tabs (which would re-create "two apps in one app"). Each row keeps its
 * origin via a badge, and an origin filter lets you narrow to one source/instance
 * on demand. Unified by default, separable when you ask.
 */
import type { Community } from "../core/model";
import type { SourceKind } from "../core/ids";
import { lemmyHome } from "./federation";

/**
 * The origin a community is filtered/badged by: "reddit" or its HOME Lemmy
 * instance host.
 *
 * A federated Lemmy community is fetched through the account that subscribes to
 * it (e.g. your hexbear.net account), so `instance` is that account's host — NOT
 * where the community actually lives. Routing correctly uses `instance` (the
 * subscribing account can act on it), but for display the origin is the home,
 * which the handle carries: remote actors are "name@home" (Voyager's rule),
 * locals are a bare "name" (home == instance). Without this, every community a
 * hexbear account follows — including federated lemmy.world/lemmy.ml ones —
 * would badge as "hexbear.net".
 */
export function originKeyOf(c: {
  source: SourceKind;
  instance: string;
  handle: string;
}): string {
  return c.source === "reddit" ? "reddit" : lemmyHome(c.handle, c.instance);
}

export interface OriginChip {
  key: string; // "all" | "reddit" | "<lemmy instance>"
  label: string;
  count: number;
}

/**
 * Build the filter chips: "All" first, then Reddit, then each Lemmy instance
 * (alphabetical). Chips appear only for origins the user actually follows, so a
 * single-instance user doesn't see noise.
 */
export function buildOriginChips(communities: Community[]): OriginChip[] {
  const counts = new Map<string, number>();
  for (const c of communities) {
    const k = originKeyOf(c);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rest = Array.from(counts.entries())
    .map(([key, count]) => ({
      key,
      label: key === "reddit" ? "Reddit" : key,
      count,
    }))
    .sort((a, b) => {
      if (a.key === "reddit") return -1;
      if (b.key === "reddit") return 1;
      return a.label.localeCompare(b.label);
    });
  return [{ key: "all", label: "All", count: communities.length }, ...rest];
}

export function filterByOrigin(
  communities: Community[],
  key: string,
): Community[] {
  if (key === "all") return communities;
  return communities.filter((c) => originKeyOf(c) === key);
}

/** Stable, case-insensitive sort by name so the merged list reads as one. */
export function sortCommunities(communities: Community[]): Community[] {
  return [...communities].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Dedupe by JanusId (defensive — the same id shouldn't arrive twice). */
export function dedupeCommunities(communities: Community[]): Community[] {
  const seen = new Set<string>();
  const out: Community[] = [];
  for (const c of communities) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
