/**
 * Aggregate feed — merges N source listings into one stream behind the same
 * useFeed() contract the single-source screens use. Each source keeps its OWN
 * ranking (globally re-sorting "hot" across federated sites is meaningless);
 * instead we round-robin interleave so every source is fairly represented, and
 * each card already carries its origin (post.source/post.instance) for display.
 *
 * Pagination threads EVERY source's cursor through one composite cursor object,
 * keyed by a caller-chosen string. A source with no further pages is marked
 * exhausted (null) and skipped on subsequent loads, so it never restarts from
 * the top and duplicates posts. Sources failing individually don't sink the
 * feed — we show whatever succeeded, and only surface an error if EVERY
 * attempted source fails on the same page.
 *
 * `createUnifiedFeed` is the original two-source (Reddit + one Lemmy) wrapper,
 * kept for its exact `{r, l}` cursor contract; new callers use
 * `createAggregateFeed` with as many sources as they like.
 */
import type { AdapterMap } from "./AdapterContext";
import type { SourceAdapter, FeedQuery } from "../core/adapter";
import type { Post } from "../core/model";
import type { Page, PageRequest, PageCursor } from "../core/pagination";
import type { TimeWindow } from "../core/capabilities";

/** Sorts common to both Reddit and Lemmy, used when the feed scope is merged. */
export const UNIFIED_FEED_SORTS = [
  { id: "hot", label: "Hot" },
  { id: "new", label: "New" },
  { id: "top", label: "Top", needsTimeWindow: true },
  { id: "controversial", label: "Controversial", needsTimeWindow: true },
] as const;

/** Round-robin merge of two lists: a[0], b[0], a[1], b[1], … keeping order. */
export function interleave<T>(a: T[], b: T[]): T[] {
  return interleaveN([a, b]);
}

/** Round-robin merge of N lists, preserving each input's internal order. */
export function interleaveN<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

/**
 * Weighted round-robin: each cycle takes `weights[i]` items from list i (in
 * order) before moving on, so a 3:1 weight surfaces ~3 of the first source per
 * 1 of the second. Falls back to 1 for any missing/non-positive weight; when all
 * weights are 1 this is identical to {@link interleaveN}. Leftovers from longer
 * lists are appended once the others run dry.
 */
export function weightedInterleaveN<T>(lists: T[][], weights: number[]): T[] {
  const idx = lists.map(() => 0);
  const out: T[] = [];
  let remaining = lists.reduce((s, l) => s + l.length, 0);
  while (remaining > 0) {
    let progressed = false;
    for (let i = 0; i < lists.length; i++) {
      const w = Math.max(1, Math.floor(weights[i] ?? 1));
      for (let k = 0; k < w && idx[i] < lists[i].length; k++) {
        out.push(lists[i][idx[i]++]);
        remaining--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

/** One source in an aggregate feed: an adapter, its query, and a cursor key. */
export interface FeedSourceSpec {
  /** Stable key for this source's slot in the composite cursor. */
  key: string;
  adapter: SourceAdapter;
  query: FeedQuery;
}

type CompositeCursor = Record<string, PageCursor | null>;

function parseComposite(cursor: PageCursor | undefined): CompositeCursor {
  if (typeof cursor !== "string") return {};
  try {
    const parsed = JSON.parse(cursor);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Merge N source listings into one paginated stream. The composite cursor is a
 * JSON object keyed by each spec's `key`; `null` marks an exhausted source.
 */
export function createAggregateFeed(
  specs: FeedSourceSpec[],
  /** Per-spec interleave weight (aligned to `specs`). Omit for an even 1:1. */
  weights?: number[],
): (page: PageRequest) => Promise<Page<Post>> {
  return async function fetchPage(page: PageRequest): Promise<Page<Post>> {
    const first = page.cursor === undefined;
    const cc = parseComposite(page.cursor);
    const limit = page.limit ?? 25;

    // A source is fetched on the first page, or while its cursor isn't null.
    const active = specs.map((s) => first || cc[s.key] !== null);

    const settled = await Promise.allSettled(
      specs.map((s, i) =>
        active[i]
          ? s.adapter.getFeed(s.query, {
              cursor: first ? undefined : (cc[s.key] ?? undefined),
              limit,
              signal: page.signal,
            })
          : Promise.resolve(null),
      ),
    );

    const pages = settled.map((r) =>
      r.status === "fulfilled" ? r.value : null,
    );

    // If every source we attempted failed, propagate so useFeed shows an error
    // (first page) or a retry footer (load-more) instead of a silent blank.
    const attempted = active.filter(Boolean).length;
    const failed = specs.filter((_, i) => active[i] && !pages[i]).length;
    if (attempted > 0 && failed === attempted) {
      const firstRejection = settled.find((r) => r.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      const err = firstRejection?.reason;
      throw err instanceof Error ? err : new Error("Feed failed to load.");
    }

    const lists = pages.map((p) => p?.items ?? []);
    const items = weights
      ? weightedInterleaveN(lists, weights)
      : interleaveN(lists);

    // Each source is exhausted (null) when skipped, failed, or out of pages.
    const next: CompositeCursor = {};
    let anyOpen = false;
    specs.forEach((s, i) => {
      const c = pages[i]?.nextCursor ?? null;
      next[s.key] = c;
      if (c !== null) anyOpen = true;
    });

    return { items, nextCursor: anyOpen ? JSON.stringify(next) : undefined };
  };
}

/**
 * Two-source (Reddit + one focused Lemmy) merge with the legacy `{r, l}` cursor
 * shape. Subscribed home = Reddit frontpage + Lemmy "Subscribed"; otherwise the
 * broad public listings.
 */
export function createUnifiedFeed(
  adapters: AdapterMap,
  opts: { sort?: string; timeWindow?: TimeWindow; subscribed?: boolean },
): (page: PageRequest) => Promise<Page<Post>> {
  return createAggregateFeed([
    {
      key: "r",
      adapter: adapters.reddit,
      query: {
        listingType: opts.subscribed ? "home" : "popular",
        sort: opts.sort,
        timeWindow: opts.timeWindow,
      },
    },
    {
      key: "l",
      adapter: adapters.lemmy,
      query: {
        listingType: opts.subscribed ? "Subscribed" : "All",
        sort: opts.sort,
        timeWindow: opts.timeWindow,
      },
    },
  ]);
}
