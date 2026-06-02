/**
 * Small data-fetching hooks shared by the screens. Kept generic and adapter-
 * agnostic so they work identically for Reddit and Lemmy.
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
  loading: boolean; // first page
  refreshing: boolean;
  loadingMore: boolean;
  error?: Error;
  atEnd: boolean;
  refresh: () => void;
  loadMore: () => void;
}

/**
 * Cursor-paginated feed: first load, pull-to-refresh, and append-on-scroll,
 * with in-flight guards so a fast scroll can't double-fetch the same page.
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
  const [atEnd, setAtEnd] = useState(false);
  const cursorRef = useRef<PageCursor | undefined>(undefined);
  const inFlight = useRef(false);

  const load = useCallback(
    async (mode: "initial" | "refresh" | "more") => {
      if (inFlight.current) return;
      if (mode === "more" && (atEnd || error)) return;
      inFlight.current = true;
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      if (mode === "more") setLoadingMore(true);
      if (mode !== "more") setError(undefined);
      try {
        const cursor = mode === "more" ? cursorRef.current : undefined;
        const page = await fetchPage({ cursor, limit: 25 });
        cursorRef.current = page.nextCursor;
        setAtEnd(page.nextCursor === undefined);
        setItems((prev) => (mode === "more" ? [...prev, ...page.items] : page.items));
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        inFlight.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [atEnd, error, ...deps],
  );

  useEffect(() => {
    cursorRef.current = undefined;
    setAtEnd(false);
    setItems([]);
    load("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => {
    cursorRef.current = undefined;
    setAtEnd(false);
    load("refresh");
  }, [load]);

  const loadMore = useCallback(() => load("more"), [load]);

  return { items, loading, refreshing, loadingMore, error, atEnd, refresh, loadMore };
}
