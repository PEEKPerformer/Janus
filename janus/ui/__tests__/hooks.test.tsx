import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useAsync, useFeed } from "../hooks";
import type { Page, PageRequest } from "../../core/pagination";

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
});
