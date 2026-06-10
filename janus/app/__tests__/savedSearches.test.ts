/**
 * Saved searches ("watches") — the local, cross-network keyword-watch store.
 * Exercised with Reddit + Lemmy scopes since one watch can span both.
 */
import {
  initSavedSearches,
  listSavedSearches,
  watchCount,
  isWatched,
  getSearch,
  addSearch,
  removeSearch,
  toggleSearch,
  markChecked,
  watchId,
  flushSavedSearches,
  __resetSavedSearches,
} from "../savedSearches";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

beforeEach(() => {
  mockStore.clear();
  __resetSavedSearches();
});
afterAll(() => __resetSavedSearches());

describe("savedSearches", () => {
  it("normalizes the watch id by query, source and community", () => {
    expect(watchId("  150K   Offer ", "all")).toBe(watchId("150k offer", "all"));
    expect(watchId("x", "all")).not.toBe(watchId("x", "reddit"));
    expect(watchId("x", "all")).not.toBe(watchId("x", "all", "c1"));
  });

  it("adds (idempotently) and reports membership per scope", async () => {
    await initSavedSearches();
    const a = addSearch({ query: "Amex 150k", source: "all" });
    const b = addSearch({ query: "amex 150k", source: "all" }); // same watch
    expect(a.id).toBe(b.id);
    expect(watchCount()).toBe(1);
    expect(isWatched("AMEX 150k", "all")).toBe(true);
    expect(isWatched("Amex 150k", "reddit")).toBe(false); // different scope
  });

  it("supports a community-scoped watch distinct from the global one", async () => {
    await initSavedSearches();
    addSearch({ query: "award space", source: "all" });
    addSearch({
      query: "award space",
      source: "reddit",
      communityId: "reddit:www.reddit.com:community:awardtravel",
      communityHandle: "r/awardtravel",
    });
    expect(watchCount()).toBe(2);
    expect(
      isWatched("award space", "reddit", "reddit:www.reddit.com:community:awardtravel"),
    ).toBe(true);
  });

  it("toggle adds then removes", async () => {
    await initSavedSearches();
    expect(toggleSearch({ query: "q", source: "lemmy" })).toBe(true);
    expect(watchCount()).toBe(1);
    expect(toggleSearch({ query: "q", source: "lemmy" })).toBe(false);
    expect(watchCount()).toBe(0);
  });

  it("markChecked folds result ids into the seen ring and stamps the time", async () => {
    await initSavedSearches();
    const w = addSearch({ query: "q", source: "all" }, 1000);
    markChecked(w.id, ["p1", "p2"], 2000);
    markChecked(w.id, ["p2", "p3"], 3000); // p2 not double-counted
    const after = getSearch(w.id)!;
    expect(after.seenIds).toEqual(["p1", "p2", "p3"]);
    expect(after.lastCheckedAt).toBe(3000);
  });

  it("persists across a reload; remove works", async () => {
    await initSavedSearches();
    const w = addSearch({ query: "keep", source: "all" });
    markChecked(w.id, ["a", "b"]);
    addSearch({ query: "drop", source: "all" });
    await flushSavedSearches();
    __resetSavedSearches();
    await initSavedSearches();
    expect(listSavedSearches().map((s) => s.query).sort()).toEqual([
      "drop",
      "keep",
    ]);
    expect(getSearch(w.id)!.seenIds).toEqual(["a", "b"]);
    removeSearch(w.id);
    expect(isWatched("keep", "all")).toBe(false);
  });
});
