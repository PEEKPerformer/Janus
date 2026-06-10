import type { Post, Comment } from "../core/model";
import { parseId, type JanusId, type SourceKind } from "../core/ids";
import { listAllSeries, type FollowedSeries } from "../app/threadSeries";
import { listSavedSearches, type SavedSearch } from "../app/savedSearches";
import { getVisit } from "../app/threadVisits";
import { resolveSeriesEdition, newestSortFor } from "../app/seriesResolve";
import {
  filterCommentsByQuery,
  unseenIds,
  type WatchAdapters,
} from "./runWatch";

/**
 * The Briefing — one digest per followed thread series, answering "what did
 * I miss?" for megathread-heavy communities (r/churning's dailies, game
 * threads, !casualconversation). Per series it resolves today's edition and
 * reports, against YOUR read state:
 *
 *  - a brand-new edition you haven't opened at all,
 *  - how many comments arrived since your last visit (threadVisits baseline),
 *  - unseen matches for every comment watch attached to the series,
 *  - the top-scored comments posted since you last looked (the "important"
 *    part — big datapoints surface even when you don't have a watch for them).
 *
 * ONE comments fetch per series powers both the watch matching and top-new,
 * paced politely. Cross-network by construction: a Lemmy daily briefs exactly
 * like a subreddit's.
 */

export interface WatchDigest {
  watch: SavedSearch;
  matches: Comment[];
  unseen: number;
}

export interface SeriesBriefing {
  series: FollowedSeries;
  /** Today's edition, or null when resolution found nothing / failed. */
  edition: Post | null;
  /** You've never opened this edition. */
  newEdition: boolean;
  /** Comments since your last visit (full count for a never-opened edition). */
  newComments: number;
  watches: WatchDigest[];
  /** Top-scored ROOT comment threads newer than your last visit, best first. */
  topNew: Comment[];
}

export interface BriefingOptions {
  sleep?: (ms: number) => Promise<void>;
  paceMs?: number;
  /** How many top new comment THREADS to surface per series. */
  topCount?: number;
}

/** Series with anything to show you — drives the "N to catch up" header. */
export function briefingNewsCount(items: readonly SeriesBriefing[]): number {
  return items.filter(
    (b) =>
      b.newEdition || b.newComments > 0 || b.watches.some((w) => w.unseen > 0),
  ).length;
}

export async function buildBriefing(
  ctx: WatchAdapters,
  opts: BriefingOptions = {},
): Promise<SeriesBriefing[]> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const paceMs = opts.paceMs ?? 400;
  const topCount = opts.topCount ?? 5;

  const series = listAllSeries();
  const commentWatches = listSavedSearches().filter(
    (s) => s.kind === "comments",
  );

  const out: SeriesBriefing[] = [];
  for (const s of series) {
    const parts = parseId(s.communityId as JanusId);
    const adapter = ctx.adapterForEntity({
      source: parts.source as SourceKind,
      instance: parts.instance,
    });

    let edition: Post | null = null;
    try {
      edition = await resolveSeriesEdition(
        adapter,
        s.communityId,
        s.label,
        s.seriesKey,
      );
    } catch {
      /* unreachable network — the row still renders, marked unresolved */
    }

    const seriesWatches = commentWatches.filter(
      (w) => w.communityId === s.communityId && w.seriesKey === s.seriesKey,
    );
    let watches: WatchDigest[] = seriesWatches.map((watch) => ({
      watch,
      matches: [],
      unseen: 0,
    }));
    let newEdition = false;
    let newComments = 0;
    let topNew: Comment[] = [];

    if (edition) {
      const visit = getVisit(edition.id);
      newEdition = !visit;
      newComments = visit
        ? Math.max(0, edition.commentCount - visit.commentCount)
        : edition.commentCount;

      // One fetch serves watch matching AND top-new.
      if (seriesWatches.length > 0 || topCount > 0) {
        try {
          const comments = await adapter
            .getComments(edition.id as JanusId, {
              sort: newestSortFor(adapter),
              limit: 100,
            })
            .then((p) => p.items);
          watches = seriesWatches.map((watch) => {
            const matches = filterCommentsByQuery(comments, watch.query);
            return {
              watch,
              matches,
              unseen: unseenIds(watch.seenIds, matches).length,
            };
          });
          const since = visit?.lastVisit ?? 0;
          // Top-level threads only: a megathread's signal lives in its root
          // comments (datapoints, questions) — replies belong in the thread
          // itself, one tap away.
          topNew = comments
            .filter((c) => !c.parentId && c.createdAt > since)
            .sort((a, b) => b.score - a.score)
            .slice(0, topCount);
        } catch {
          /* comments unreachable — edition status still shows */
        }
      }
    }

    out.push({ series: s, edition, newEdition, newComments, watches, topNew });
    await sleep(paceMs);
  }
  return out;
}
