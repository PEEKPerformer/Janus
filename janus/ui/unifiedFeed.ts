/**
 * Unified "All" feed — merges Reddit + Lemmy into one stream behind the same
 * useFeed() contract the single-source screens use. Each source keeps its OWN
 * ranking (we don't try to globally re-sort "hot" across two sites, which is
 * meaningless); instead we round-robin interleave so both are fairly
 * represented, and tag each card with its source.
 *
 * Pagination threads BOTH sources' cursors through one composite string cursor.
 * A source with no further pages is marked exhausted (null) and skipped on
 * subsequent loads, so it never restarts from the top and duplicates posts.
 * One source failing (e.g. Reddit needs login) doesn't sink the feed — we show
 * whatever succeeded, and only surface an error if BOTH fail on the first page.
 */
import type { AdapterMap } from "./AdapterContext";
import type { Post } from "../core/model";
import type { Page, PageRequest, PageCursor } from "../core/pagination";
import type { TimeWindow } from "../core/capabilities";

/** null = that source is exhausted; absent = first load (start from the top). */
interface CompositeCursor {
  r?: PageCursor | null;
  l?: PageCursor | null;
}

/** Sorts common to both Reddit and Lemmy, used when the feed scope is "All". */
export const UNIFIED_FEED_SORTS = [
  { id: "hot", label: "Hot" },
  { id: "new", label: "New" },
  { id: "top", label: "Top", needsTimeWindow: true },
  { id: "controversial", label: "Controversial", needsTimeWindow: true },
] as const;

/** Round-robin merge: a[0], b[0], a[1], b[1], … keeping each input's order. */
export function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

function parseCursor(cursor: PageCursor | undefined): CompositeCursor {
  if (typeof cursor !== "string") return {};
  try {
    return JSON.parse(cursor) as CompositeCursor;
  } catch {
    return {};
  }
}

export function createUnifiedFeed(
  adapters: AdapterMap,
  opts: { sort?: string; timeWindow?: TimeWindow; subscribed?: boolean },
): (page: PageRequest) => Promise<Page<Post>> {
  // Subscribed home = Reddit frontpage + Lemmy "Subscribed"; otherwise the
  // broad public listings.
  const redditListing = opts.subscribed ? "home" : "popular";
  const lemmyListing = opts.subscribed ? "Subscribed" : "All";
  return async function fetchPage(page: PageRequest): Promise<Page<Post>> {
    const first = page.cursor === undefined;
    const uc = parseCursor(page.cursor);
    const limit = page.limit ?? 25;

    const wantReddit = first || uc.r !== null;
    const wantLemmy = first || uc.l !== null;

    const redditP = wantReddit
      ? adapters.reddit.getFeed(
          {
            listingType: redditListing,
            sort: opts.sort,
            timeWindow: opts.timeWindow,
          },
          {
            cursor: first ? undefined : (uc.r ?? undefined),
            limit,
            signal: page.signal,
          },
        )
      : null;
    const lemmyP = wantLemmy
      ? adapters.lemmy.getFeed(
          {
            listingType: lemmyListing,
            sort: opts.sort,
            timeWindow: opts.timeWindow,
          },
          {
            cursor: first ? undefined : (uc.l ?? undefined),
            limit,
            signal: page.signal,
          },
        )
      : null;

    const [rSettled, lSettled] = await Promise.allSettled([
      redditP ?? Promise.resolve(null),
      lemmyP ?? Promise.resolve(null),
    ]);

    const rPage = rSettled.status === "fulfilled" ? rSettled.value : null;
    const lPage = lSettled.status === "fulfilled" ? lSettled.value : null;

    // If everything we attempted failed, propagate so useFeed shows an error
    // (first page) or a retry footer (load-more) rather than a silent blank.
    const attempted = (redditP ? 1 : 0) + (lemmyP ? 1 : 0);
    const failed = (redditP && !rPage ? 1 : 0) + (lemmyP && !lPage ? 1 : 0);
    if (attempted > 0 && failed === attempted) {
      const err =
        rSettled.status === "rejected"
          ? rSettled.reason
          : (lSettled as PromiseRejectedResult).reason;
      throw err instanceof Error
        ? err
        : new Error("Unified feed failed to load.");
    }

    const items = interleave(rPage?.items ?? [], lPage?.items ?? []);

    // A source is exhausted (null) when it was skipped, failed, or returned no
    // next cursor. When BOTH are exhausted the whole feed is at its end.
    const rNext: PageCursor | null = rPage?.nextCursor ?? null;
    const lNext: PageCursor | null = lPage?.nextCursor ?? null;
    const nextCursor =
      rNext === null && lNext === null
        ? undefined
        : JSON.stringify({ r: rNext, l: lNext });

    return { items, nextCursor };
  };
}
