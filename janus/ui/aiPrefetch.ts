import type { Post, Comment } from "../core/model";
import type { JanusId, SourceKind } from "../core/ids";
import { parseId } from "../core/ids";
import type { SourceAdapter } from "../core/adapter";
import type { Page } from "../core/pagination";
import {
  COMMENTS_CACHE,
  COMMENTS_TTL_MS,
  commentsCacheKey,
} from "../app/contentCaches";
import { cachedVerdict } from "../app/aiLens";
import type { AiQueue } from "../app/aiLensQueue";

/**
 * "Ahead of you" prefetching: while the user browses the feed, judge what
 * they're likely to open NEXT, so verdicts come from cache the moment a
 * thread appears. Two tiers per feed page:
 *
 * 1. Every text post's body is queued for judging (inference only — the
 *    text is already in hand).
 * 2. The most-commented few threads get their comments fetched into the
 *    shared comments cache (which makes the thread itself open instantly,
 *    AI Lens aside) and their top root comments queued.
 *
 * All inference rides the global queue at prefetch priority — taps and
 * auto checks always jump ahead, and leaving the feed sheds the backlog.
 * Already-judged text never re-queues (verdict-cache check up front).
 */

export interface PrefetchDeps {
  adapterForEntity: (e: {
    source: SourceKind;
    instance: string;
  }) => SourceAdapter;
  resolveSort: (adapter: SourceAdapter, communityId: string) => Promise<string>;
  queue: AiQueue;
  isOffline?: () => boolean;
  modelSha?: string;
  now?: () => number;
  /** Threads whose comments are fetched + judged per page. */
  threadCap?: number;
  /** Root comments judged per prefetched thread. */
  rootsCap?: number;
}

const MIN_BODY_CHARS = 180; // shorter text is refused by the detector anyway

export function createAiPrefetcher(deps: PrefetchDeps) {
  const seenPosts = new Set<string>();
  const seenThreads = new Set<string>();
  const enqueue = (text: string) => {
    if (text.length < MIN_BODY_CHARS) return;
    if (cachedVerdict(text, deps.modelSha)) return;
    deps.queue.run(text, 2).catch(() => {
      /* shed or failed prefetch — it was speculative */
    });
  };

  return async function prefetchPage(posts: Post[]): Promise<void> {
    // Tier 1: post bodies — free of network, queue them all.
    for (const post of posts) {
      if (seenPosts.has(post.id)) continue;
      seenPosts.add(post.id);
      enqueue(post.body?.text?.trim() ?? "");
    }

    // Tier 2: comments for the threads most likely to be opened.
    if (deps.isOffline?.()) return;
    const candidates = posts
      .filter((p) => !seenThreads.has(p.id) && (p.commentCount ?? 0) > 0)
      .sort((a, b) => (b.commentCount ?? 0) - (a.commentCount ?? 0))
      .slice(0, deps.threadCap ?? 4);
    for (const post of candidates) {
      seenThreads.add(post.id);
      try {
        const parts = parseId(post.id as JanusId);
        const adapter = deps.adapterForEntity({
          source: parts.source as SourceKind,
          instance: parts.instance,
        });
        const sort = await deps.resolveSort(adapter, post.community.id);
        const key = commentsCacheKey(post.source, post.id, sort);
        const now = deps.now?.() ?? Date.now();
        // Cache-first: a fresh page (recent visit, plane-mode pack) costs
        // nothing; otherwise one polite fetch that ALSO warms thread-open.
        const hit = COMMENTS_CACHE.read<Page<Comment>>(
          key,
          now,
          COMMENTS_TTL_MS,
        );
        let items = hit?.value.items;
        if (!items) {
          const page = await adapter.getComments(post.id as JanusId, {
            sort: sort || undefined,
            limit: 100,
          });
          COMMENTS_CACHE.write(key, page, now);
          items = page.items;
        }
        const roots = items
          .filter((c) => !c.parentId)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, deps.rootsCap ?? 6);
        for (const c of roots) enqueue(c.body?.text?.trim() ?? "");
      } catch {
        /* speculative — a failed thread prefetch costs nothing */
      }
    }
  };
}
