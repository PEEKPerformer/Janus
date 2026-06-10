import type { Post } from "../core/model";
import type { SourceAdapter } from "../core/adapter";
import type { JanusId } from "../core/ids";
import { titleMatchesSeries } from "./threadSeries";

/** Reddit search sorts are lowercase, Lemmy's are PascalCase — pick "newest". */
export const newestSortFor = (adapter: SourceAdapter): string =>
  adapter.source === "reddit" ? "new" : "New";

const newestOf = (items: Post[], seriesKey: string): Post | null =>
  items
    .filter(
      (p) =>
        typeof p.title === "string" && titleMatchesSeries(p.title, seriesKey),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

/**
 * Resolve the newest edition of a followed thread series. Shared by comment
 * watches, the plane-mode packer and the briefing — one definition of
 * "today's thread". Two stages, because source search engines are weak:
 *
 *  1. A community search on a SHORTENED label (long weekly titles return
 *     nothing from Reddit's keyword search; the first few tokens hit).
 *  2. Fall back to scanning the community's newest posts directly — the
 *     robust path for weeklies/stickies that search misses entirely.
 *
 * Throws only when BOTH stages fail on transport; returns null when neither
 * finds an edition.
 */
export async function resolveSeriesEdition(
  adapter: SourceAdapter,
  communityId: string,
  label: string,
  seriesKey: string,
): Promise<Post | null> {
  let searchFailed: unknown = null;
  try {
    const query = label.split(" ").slice(0, 5).join(" ");
    const page = await adapter.search(query, "posts", {
      limit: 10,
      sort: newestSortFor(adapter),
      communityId: communityId as JanusId,
    });
    const hit = newestOf(page.items as Post[], seriesKey);
    if (hit) return hit;
  } catch (e) {
    searchFailed = e;
  }
  try {
    const feed = await adapter.getFeed(
      { communityId: communityId as JanusId, sort: newestSortFor(adapter) },
      { limit: 100 },
    );
    return newestOf(feed.items, seriesKey);
  } catch (e) {
    throw searchFailed ?? e;
  }
}
