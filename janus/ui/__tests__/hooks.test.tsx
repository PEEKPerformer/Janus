import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useAsync, useFeed, useCachedAsync, useOffline } from "../hooks";
import { __setOffline, __resetOffline, isOffline } from "../../app/offline";
import type { Page, PageRequest } from "../../core/pagination";
import type { SwrCache, CacheRead } from "../../app/swrCache";
import { configureAnalytics } from "../../app/analytics";
import { RateLimitError } from "../../core/errors";

/** In-memory SwrCache double. */
function memCache(): SwrCache {
  const store = new Map<string, { ts: number; value: unknown }>();
  return {
    read<T>(key: string, atNow: number, ttlMs: number): CacheRead<T> | null {
      const e = store.get(key);
      if (!e) return null;
      const ageMs = atNow - e.ts;
      return { value: e.value as T, ageMs, fresh: ageMs <= ttlMs };
    },
    write<T>(key: string, value: T, atNow: number) {
      store.set(key, { ts: atNow, value });
    },
    remove(key: string) {
      store.delete(key);
    },
  };
}

describe("useCachedAsync (cache-first / Reddit-politeness)", () => {
  it("cacheFirst skips the network while the cache is fresh", async () => {
    const cache = memCache();
    let calls = 0;
    const fetcher = async () => ++calls;
    const first = renderHook(() =>
      useCachedAsync(cache, "k", 60_000, fetcher, [], { cacheFirst: true }),
    );
    await waitFor(() => expect(first.result.current.data).toBe(1));
    expect(calls).toBe(1);
    // Remount within TTL: served from cache, NO second fetch.
    const second = renderHook(() =>
      useCachedAsync(cache, "k", 60_000, fetcher, [], { cacheFirst: true }),
    );
    await waitFor(() => expect(second.result.current.data).toBe(1));
    expect(calls).toBe(1); // the win: no extra Reddit hit
  });

  it("default (SWR) mode always revalidates on mount", async () => {
    const cache = memCache();
    let calls = 0;
    const fetcher = async () => ++calls;
    const first = renderHook(() =>
      useCachedAsync(cache, "k", 60_000, fetcher, []),
    );
    await waitFor(() => expect(first.result.current.data).toBe(1));
    const second = renderHook(() =>
      useCachedAsync(cache, "k", 60_000, fetcher, []),
    );
    await waitFor(() => expect(second.result.current.data).toBe(2));
    expect(calls).toBe(2);
  });

  it("reload() forces a refetch past the cache-first short-circuit", async () => {
    const cache = memCache();
    let calls = 0;
    const { result } = renderHook(() =>
      useCachedAsync(cache, "k", 60_000, async () => ++calls, [], {
        cacheFirst: true,
      }),
    );
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(calls).toBe(2);
  });
});

describe("useCachedAsync (offline / plane mode)", () => {
  afterEach(() => __resetOffline());

  it("offline serves even a STALE cached value and skips the fetch", async () => {
    const cache = memCache();
    cache.write("k", 7, 0); // long past any TTL
    __setOffline(true);
    let calls = 0;
    const { result } = renderHook(() =>
      useCachedAsync(cache, "k", 1, async () => ++calls, []),
    );
    await waitFor(() => expect(result.current.data).toBe(7));
    expect(calls).toBe(0); // no doomed fetch, no error
    expect(result.current.error).toBeUndefined();
    expect(result.current.revalidating).toBe(false);
  });

  it("offline with NO cached value still attempts the fetch", async () => {
    __setOffline(true);
    let calls = 0;
    const { result } = renderHook(() =>
      useCachedAsync(memCache(), "k", 60_000, async () => ++calls, []),
    );
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(calls).toBe(1);
  });

  it("a streak of connectivity-shaped fetch failures infers offline", async () => {
    const cache = memCache();
    const die = async () => {
      throw new TypeError("Network request failed");
    };
    const first = renderHook(() => useCachedAsync(cache, "a", 60_000, die, []));
    await waitFor(() => expect(first.result.current.error).toBeTruthy());
    expect(isOffline()).toBe(false); // one blip isn't a verdict
    const second = renderHook(() =>
      useCachedAsync(cache, "b", 60_000, die, []),
    );
    await waitFor(() => expect(second.result.current.error).toBeTruthy());
    expect(isOffline()).toBe(true); // garage mode engaged

    // The next success — any source answering — clears it.
    const third = renderHook(() =>
      useCachedAsync(cache, "c", 60_000, async () => 1, []),
    );
    await waitFor(() => expect(third.result.current.data).toBe(1));
    expect(isOffline()).toBe(false);
  });

  it("manual reload while offline forces a fetch (signals can lie)", async () => {
    const cache = memCache();
    cache.write("k", 7, 0);
    __setOffline(true);
    let calls = 0;
    const { result } = renderHook(() =>
      useCachedAsync(cache, "k", 1, async () => ++calls, []),
    );
    await waitFor(() => expect(result.current.data).toBe(7));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(calls).toBe(1);
  });
});

describe("useOffline", () => {
  afterEach(() => __resetOffline());

  it("tracks offline flips", async () => {
    const { result } = renderHook(() => useOffline());
    expect(result.current).toBe(false);
    act(() => __setOffline(true));
    await waitFor(() => expect(result.current).toBe(true));
    act(() => __setOffline(false));
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe("useAsync", () => {
  it("resolves data and clears loading", async () => {
    const { result } = renderHook(() => useAsync(async () => 42, []));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(42);
    expect(result.current.error).toBeUndefined();
  });

  it("captures errors", async () => {
    const { result } = renderHook(() =>
      useAsync(async () => {
        throw new Error("boom");
      }, []),
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error?.message).toBe("boom");
  });

  it("refetches on reload", async () => {
    let calls = 0;
    const { result } = renderHook(() => useAsync(async () => ++calls, []));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(2));
  });
});

describe("useFeed", () => {
  function scriptedPager() {
    let calls = 0;
    const fetchPage = async (req: PageRequest): Promise<Page<number>> => {
      calls++;
      if (!req.cursor) return { items: [1, 2], nextCursor: "c1" };
      if (req.cursor === "c1") return { items: [3, 4] }; // no nextCursor => atEnd
      return { items: [] };
    };
    return { fetchPage, getCalls: () => calls };
  }

  it("loads the first page and exposes the cursor", async () => {
    const { fetchPage } = scriptedPager();
    const { result } = renderHook(() => useFeed(fetchPage, ["k"]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([1, 2]);
    expect(result.current.atEnd).toBe(false);
  });

  it("appends on loadMore and stops at the end", async () => {
    const { fetchPage, getCalls } = scriptedPager();
    const { result } = renderHook(() => useFeed(fetchPage, ["k"]));
    await waitFor(() => expect(result.current.items).toEqual([1, 2]));

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items).toEqual([1, 2, 3, 4]);
    expect(result.current.atEnd).toBe(true);

    // loadMore past the end is a no-op (guarded).
    await act(async () => {
      await result.current.loadMore();
    });
    expect(getCalls()).toBe(2); // initial + one loadMore only
  });

  it("surfaces errors from the first page", async () => {
    const fetchPage = async (): Promise<Page<number>> => {
      throw new Error("offline");
    };
    const { result } = renderHook(() => useFeed(fetchPage, ["k"]));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.items).toEqual([]);
  });

  it("emits feed_page analytics only when a surface label is given", async () => {
    const events: { event: string; props?: Record<string, unknown> }[] = [];
    configureAnalytics({
      capture: (event, props) => void events.push({ event, props }),
      screen: () => {},
    });
    try {
      const { fetchPage } = scriptedPager();
      const unlabeled = renderHook(() => useFeed(fetchPage, ["k"]));
      await waitFor(() => expect(unlabeled.result.current.loading).toBe(false));
      expect(events).toEqual([]); // unlabeled feeds stay silent

      const labeled = renderHook(() =>
        useFeed(scriptedPager().fetchPage, ["k"], "home"),
      );
      await waitFor(() => expect(labeled.result.current.loading).toBe(false));
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("feed_page");
      expect(events[0].props).toMatchObject({
        surface: "home",
        mode: "initial",
        ok: true,
        count: 2,
      });

      const failing = renderHook(() =>
        useFeed(
          async () => {
            throw new RateLimitError(120);
          },
          ["k"],
          "home",
        ),
      );
      await waitFor(() => expect(failing.result.current.error).toBeTruthy());
      const fail = events.find((e) => e.props?.ok === false);
      expect(fail?.props).toMatchObject({
        error_code: "RATE_LIMITED",
        count: 0,
      });
    } finally {
      configureAnalytics(null);
    }
  });
});
