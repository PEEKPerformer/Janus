import type { Post } from "../core/model";
import type { SourceAdapter } from "../core/adapter";
import type { JanusId } from "../core/ids";
import { titleMatchesSeries } from "./threadSeries";

/** Reddit search sorts are lowercase, Lemmy's are PascalCase — pick "newest". */
export const newestSortFor = (adapter: SourceAdapter): string =>
  adapter.source === "reddit" ? "new" : "New";

/**
 * Resolve the newest edition of a followed thread series: search the
 * community for the series label, keep posts whose titles normalize into the
 * series, take the newest. Shared by comment watches, the plane-mode packer
 * and the briefing — one definition of "today's thread". Throws on transport
 * failure (callers decide their fallback); returns null when the search
 * simply finds no edition.
 */
export async function resolveSeriesEdition(
  adapter: SourceAdapter,
  communityId: string,
  label: string,
  seriesKey: string,
): Promise<Post | null> {
  const page = await adapter.search(label, "posts", {
    limit: 10,
    sort: newestSortFor(adapter),
    communityId: communityId as JanusId,
  });
  const editions = (page.items as Post[]).filter(
    (p) =>
      typeof p.title === "string" && titleMatchesSeries(p.title, seriesKey),
  );
  return editions.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}
