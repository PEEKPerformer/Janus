import type { Post } from "../core/model";
import type { SourceAdapter } from "../core/adapter";
import type { SavedSearch } from "../app/savedSearches";
import { parseId, type SourceKind } from "../core/ids";

/**
 * Resolve which adapters a watch fans out over, then run its query as a
 * newest-first post search on each and merge — newest across sources first.
 * Cross-network falls straight out of the adapter interface: a global watch
 * hits Reddit and the focused Lemmy instance; a community watch hits just that
 * community's origin. Pure given its adapters, so it's easy to test.
 */
export interface WatchAdapters {
  reddit: SourceAdapter;
  /** The focused Lemmy adapter (back-compat single-source view). */
  lemmy: SourceAdapter;
  adapterForEntity: (e: { source: SourceKind; instance: string }) => SourceAdapter;
}

export function adaptersForWatch(
  search: SavedSearch,
  ctx: WatchAdapters,
): SourceAdapter[] {
  if (search.communityId) {
    const parts = parseId(search.communityId as Parameters<typeof parseId>[0]);
    return [
      ctx.adapterForEntity({
        source: parts.source as SourceKind,
        instance: parts.instance,
      }),
    ];
  }
  if (search.source === "reddit") return [ctx.reddit];
  if (search.source === "lemmy") return [ctx.lemmy];
  return [ctx.reddit, ctx.lemmy];
}

/** Reddit search sorts are lowercase, Lemmy's are PascalCase — pick "newest". */
function newestSort(adapter: SourceAdapter): string {
  return adapter.source === "reddit" ? "new" : "New";
}

export async function runWatch(
  search: SavedSearch,
  ctx: WatchAdapters,
  limit = 25,
): Promise<Post[]> {
  const adapters = adaptersForWatch(search, ctx);
  const settled = await Promise.allSettled(
    adapters.map((a) =>
      a.search(search.query, "posts", {
        limit,
        sort: newestSort(a),
        communityId: search.communityId
          ? (search.communityId as Parameters<typeof parseId>[0])
          : undefined,
      }),
    ),
  );
  const posts: Post[] = settled.flatMap((r) =>
    r.status === "fulfilled"
      ? (r.value.items.filter((i) => "title" in i) as Post[])
      : [],
  );
  // Newest across sources first; de-dupe federated echoes by dedupKey.
  const seen = new Set<string>();
  return posts
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((p) => {
      const k = p.dedupKey ?? p.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Ids in `results` this watch hasn't shown you yet — the "N new" count. */
export function unseenIds(seenIds: string[], results: Post[]): string[] {
  const seen = new Set(seenIds);
  return results.filter((p) => !seen.has(p.id)).map((p) => p.id);
}
