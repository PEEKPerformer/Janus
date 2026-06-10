/**
 * Small data-fetching hooks shared by the screens. Adapter-agnostic, so they
 * work identically for Reddit and Lemmy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Page, PageRequest, PageCursor } from "../core/pagination";
import type { SwrCache } from "../app/swrCache";

export interface AggregateSource<T> {
  /** Stable key (e.g. "reddit:www.reddit.com") for per-source cursor tracking. */
  key: string;
  fetch: (page: PageRequest) => Promise<Page<T>>;
}

export interface AsyncState<T> {
  data?: T;
  loading: boolean;
  error?: Error;
  reload: () => void;
}

/** One-shot async load with loading/error and a manual reload. */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fn()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}

export interface CachedAsyncState<T> extends AsyncState<T> {
  /** A background refetch is in flight (cached data is already shown). */
  revalidating: boolean;
  /** Showing cached data that's past its TTL (until the refetch lands). */
  stale: boolean;
}

/**
 * Stale-while-revalidate async load. Paints any disk-cached value INSTANTLY
 * (MMKV is synchronous, so the very first render already has data — no spinner
 * on a warm launch), then refetches in the background and writes through. Errors
 * never blow away cached data. Pass `cacheKey: null` to disable caching/fetching
 * (e.g. before the user is ready) — the hook then sits idle with no data.
 *
 * Built for slow-changing, list-shaped data (subscriptions, a community's about,
 * a profile). NOT for feeds.
 */
export interface CachedAsyncOptions {
  /**
   * When true, a cache hit that's still FRESH (within ttl) short-circuits the
   * network entirely — no refetch until it goes stale. This is the knob that
   * actually cuts request volume (re-opening a thread within the TTL costs
   * zero Reddit calls). A manual `reload()` always forces a refetch regardless.
   * Default false = classic stale-while-revalidate (always refetches on mount).
   */
  cacheFirst?: boolean;
}

export function useCachedAsync<T>(
  cache: SwrCache,
  cacheKey: string | null,
  ttlMs: number,
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: CachedAsyncOptions = {},
): CachedAsyncState<T> {
  // Read the cache once for the initial key, synchronously, so first paint has it.
  const initial = useMemo(
    () => (cacheKey ? cache.read<T>(cacheKey, Date.now(), ttlMs) : null),

    [],
  );
  const [data, setData] = useState<T | undefined>(initial?.value);
  const [loading, setLoading] = useState(!!cacheKey && !initial);
  const [stale, setStale] = useState(initial ? !initial.fresh : false);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<Error>();
  const [nonce, setNonce] = useState(0);
  // A manual reload forces the next fetch past the cache-first short-circuit.
  const forced = useRef(false);
  const reload = useCallback(() => {
    forced.current = true;
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!cacheKey) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Surface any cached value for the (possibly new) key right away.
    const cached = cache.read<T>(cacheKey, Date.now(), ttlMs);
    if (cached) {
      setData(cached.value);
      setLoading(false);
      setStale(!cached.fresh);
    } else {
      setLoading(true);
      setStale(false);
    }
    const wasForced = forced.current;
    forced.current = false;
    // Cache-first: a fresh hit means we skip the network — Reddit stays happy.
    if (opts.cacheFirst && cached?.fresh && !wasForced) {
      setRevalidating(false);
      return;
    }
    setRevalidating(true);
    setError(undefined);
    fetcher()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setStale(false);
        cache.write(cacheKey, res, Date.now());
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRevalidating(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, nonce, cacheKey]);

  return { data, loading, error, reload, revalidating, stale };
}

export interface FeedState<T> {
  items: T[];
  loading: boolean; // first page only
  refreshing: boolean;
  loadingMore: boolean;
  error?: Error; // first-page error (drives the empty/error state)
  loadMoreError?: Error; // pagination error (drives a retry footer, never latches)
  atEnd: boolean;
  refresh: () => void;
  loadMore: () => void;
}

/**
 * Cursor-paginated feed with first-load / pull-to-refresh / append-on-scroll.
 *
 * Correctness guards:
 *  - a GENERATION counter: when `deps` change (e.g. the user switches source)
 *    or on refresh, in-flight responses from the old generation are discarded,
 *    so a slow request can never paint the previous source's posts under the
 *    new tab.
 *  - first-page error and pagination error are SEPARATE: a single transient
 *    load-more failure surfaces as `loadMoreError` (retryable) and does not
 *    permanently dead-end infinite scroll.
 */
export function useFeed<T>(
  fetchPage: (page: PageRequest) => Promise<Page<T>>,
  deps: unknown[],
): FeedState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error>();
  const [loadMoreError, setLoadMoreError] = useState<Error>();
  const [atEnd, setAtEnd] = useState(false);

  const cursorRef = useRef<PageCursor | undefined>(undefined);
  const inFlight = useRef(false);
  const atEndRef = useRef(false);
  const genRef = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const run = useCallback(async (mode: "initial" | "refresh" | "more") => {
    if (mode === "more" && (inFlight.current || atEndRef.current)) return;
    const gen = genRef.current;
    inFlight.current = true;
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    if (mode === "more") {
      setLoadingMore(true);
      setLoadMoreError(undefined);
    } else {
      setError(undefined);
    }
    try {
      const cursor = mode === "more" ? cursorRef.current : undefined;
      const page = await fetchRef.current({ cursor, limit: 25 });
      if (gen !== genRef.current) return; // stale generation — discard
      cursorRef.current = page.nextCursor;
      atEndRef.current = page.nextCursor === undefined;
      setAtEnd(atEndRef.current);
      setItems((prev) =>
        mode === "more" ? [...prev, ...page.items] : page.items,
      );
    } catch (e) {
      if (gen !== genRef.current) return;
      const err = e instanceof Error ? e : new Error(String(e));
      if (mode === "more") setLoadMoreError(err);
      else setError(err);
    } finally {
      if (gen === genRef.current) {
        inFlight.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const resetAndLoad = useCallback(
    (mode: "initial" | "refresh") => {
      genRef.current++;
      inFlight.current = false;
      cursorRef.current = undefined;
      atEndRef.current = false;
      setAtEnd(false);
      if (mode === "initial") {
        setItems([]);
        setError(undefined);
        setLoadMoreError(undefined);
      }
      run(mode);
    },
    [run],
  );

  useEffect(() => {
    resetAndLoad("initial");
  }, deps);

  const refresh = useCallback(() => resetAndLoad("refresh"), [resetAndLoad]);
  const loadMore = useCallback(() => run("more"), [run]);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    error,
    loadMoreError,
    atEnd,
    refresh,
    loadMore,
  };
}

/**
 * Fans a feed across SEVERAL sources (e.g. Reddit + each signed-in Lemmy
 * instance for the unified inbox) and merges them into one time-sorted stream.
 *
 *  - Each source paginates independently; a per-source cursor is tracked, and a
 *    source drops out of `loadMore` once it returns `nextCursor === undefined`.
 *  - The merged list is re-sorted by `sortDesc` (newest first) and de-duped by
 *    `keyOf` on every change, so cross-source interleaving stays correct across
 *    page boundaries.
 *  - First-page error only latches when EVERY source failed; a single source
 *    failing still shows the others (best-effort, like the search screen).
 */
export function useAggregateFeed<T>(
  sources: AggregateSource<T>[],
  keyOf: (item: T) => string,
  sortDesc: (item: T) => number,
  deps: unknown[],
): FeedState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error>();
  const [loadMoreError, setLoadMoreError] = useState<Error>();
  const [atEnd, setAtEnd] = useState(false);

  // Per-source cursor; a key absent from the map means "not yet at end".
  const cursors = useRef<Map<string, PageCursor | undefined>>(new Map());
  const done = useRef<Set<string>>(new Set());
  const merged = useRef<Map<string, T>>(new Map());
  const inFlight = useRef(false);
  const genRef = useRef(0);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const recompute = useCallback(() => {
    const list = [...merged.current.values()].sort(
      (a, b) => sortDesc(b) - sortDesc(a),
    );
    setItems(list);
  }, []);

  const run = useCallback(
    async (mode: "initial" | "refresh" | "more") => {
      if (mode === "more" && (inFlight.current || atEnd)) return;
      const gen = genRef.current;
      inFlight.current = true;
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      if (mode === "more") {
        setLoadingMore(true);
        setLoadMoreError(undefined);
      } else {
        setError(undefined);
      }

      const active = sourcesRef.current.filter((s) => !done.current.has(s.key));
      const settled = await Promise.allSettled(
        active.map((s) =>
          s
            .fetch({ cursor: cursors.current.get(s.key), limit: 25 })
            .then((page) => ({ key: s.key, page })),
        ),
      );
      if (gen !== genRef.current) return;

      let anyOk = false;
      let firstErr: Error | undefined;
      for (const r of settled) {
        if (r.status === "fulfilled") {
          anyOk = true;
          const { key, page } = r.value;
          for (const item of page.items) merged.current.set(keyOf(item), item);
          cursors.current.set(key, page.nextCursor);
          if (page.nextCursor === undefined) done.current.add(key);
        } else if (!firstErr) {
          firstErr =
            r.reason instanceof Error ? r.reason : new Error(String(r.reason));
        }
      }

      recompute();
      const allDone =
        sourcesRef.current.length > 0 &&
        sourcesRef.current.every((s) => done.current.has(s.key));
      setAtEnd(allDone);
      if (mode === "more") {
        if (!anyOk && firstErr) setLoadMoreError(firstErr);
      } else if (!anyOk && firstErr) {
        setError(firstErr);
      }
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    },
    [atEnd, keyOf, recompute],
  );

  const resetAndLoad = useCallback(
    (mode: "initial" | "refresh") => {
      genRef.current++;
      inFlight.current = false;
      cursors.current = new Map();
      done.current = new Set();
      merged.current = new Map();
      setAtEnd(false);
      if (mode === "initial") {
        setItems([]);
        setError(undefined);
        setLoadMoreError(undefined);
      }
      run(mode);
    },
    [run],
  );

  useEffect(() => {
    resetAndLoad("initial");
  }, deps);

  const refresh = useCallback(() => resetAndLoad("refresh"), [resetAndLoad]);
  const loadMore = useCallback(() => run("more"), [run]);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    error,
    loadMoreError,
    atEnd,
    refresh,
    loadMore,
  };
}
