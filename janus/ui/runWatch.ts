import type { Post, Comment } from "../core/model";
import type { SourceAdapter } from "../core/adapter";
import type { SavedSearch } from "../app/savedSearches";
import { parseId, type SourceKind, type JanusId } from "../core/ids";
import { resolveSeriesEdition } from "../app/seriesResolve";

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
  adapterForEntity: (e: {
    source: SourceKind;
    instance: string;
  }) => SourceAdapter;
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
export function unseenIds(
  seenIds: string[],
  results: readonly { id: string }[],
): string[] {
  const seen = new Set(seenIds);
  return results.filter((r) => !seen.has(r.id)).map((r) => r.id);
}

/** Comments whose body contains the query (case-insensitive), newest first. */
export function filterCommentsByQuery(
  comments: readonly Comment[],
  query: string,
): Comment[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return comments
    .filter((c) => c.body.text?.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export interface CommentWatchResult {
  /** The thread edition the matches came from (for navigation), or null. */
  post: Post | null;
  matches: Comment[];
}

/**
 * Run a comment watch: resolve the newest edition of the watched thread series
 * (so it follows r/churning's daily as it rotates), fetch its comments, and
 * keep the ones matching the keyword. Falls back to the thread the watch was
 * created from if the series search comes up empty. Single-community by
 * nature, but works the same on a subreddit or a Lemmy community.
 */
export async function runCommentWatch(
  search: SavedSearch,
  ctx: WatchAdapters,
): Promise<CommentWatchResult> {
  if (!search.communityId) return { post: null, matches: [] };
  const parts = parseId(search.communityId as JanusId);
  const adapter = ctx.adapterForEntity({
    source: parts.source as SourceKind,
    instance: parts.instance,
  });

  // Resolve the newest edition of the series.
  let postId = search.postId;
  const { seriesKey, seriesLabel } = search;
  if (seriesKey && seriesLabel) {
    try {
      const newest = await resolveSeriesEdition(
        adapter,
        search.communityId,
        seriesLabel,
        seriesKey,
      );
      if (newest) postId = newest.id;
    } catch {
      /* fall back to the stored postId */
    }
  }
  if (!postId) return { post: null, matches: [] };

  const [post, comments] = await Promise.all([
    adapter.getPost(postId as JanusId).catch(() => null),
    adapter
      .getComments(postId as JanusId, { sort: newestSort(adapter) })
      .then((p) => p.items)
      .catch(() => [] as Comment[]),
  ]);
  return { post, matches: filterCommentsByQuery(comments, search.query) };
}
