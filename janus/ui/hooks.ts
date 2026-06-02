/**
 * Small data-fetching hooks shared by the screens. Adapter-agnostic, so they
 * work identically for Reddit and Lemmy.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Page, PageRequest, PageCursor } from "../core/pagination";

export interface AsyncState<T> {
  data?: T;
  loading: boolean;
  error?: Error;
  reload: () => void;
}

/** One-shot async load with loading/error and a manual reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
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
export function useFeed<T>(fetchPage: (page: PageRequest) => Promise<Page<T>>, deps: unknown[]): FeedState<T> {
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
      setItems((prev) => (mode === "more" ? [...prev, ...page.items] : page.items));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => resetAndLoad("refresh"), [resetAndLoad]);
  const loadMore = useCallback(() => run("more"), [run]);

  return { items, loading, refreshing, loadingMore, error, loadMoreError, atEnd, refresh, loadMore };
}
