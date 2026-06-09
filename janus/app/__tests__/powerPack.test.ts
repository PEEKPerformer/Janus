/**
 * Power-pack stores: thread visits (new-comment tracking + history) and
 * RES-style user tags. Both are source-agnostic — exercised below with Reddit
 * AND Lemmy shaped ids/handles, since cross-network parity is the contract.
 */
import {
  initThreadVisits,
  recordVisit,
  getVisit,
  listHistory,
  clearHistory,
  flushThreadVisits,
  __resetThreadVisits,
  type VisitablePost,
} from "../threadVisits";
import {
  initUserTags,
  getUserTag,
  setUserTag,
  removeUserTag,
  flushUserTags,
  __resetUserTags,
} from "../userTags";

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
  __resetThreadVisits();
  __resetUserTags();
});

const redditPost: VisitablePost = {
  id: "reddit:www.reddit.com:post:abc",
  commentCount: 100,
  title: "A reddit post",
  community: { handle: "r/test" },
  source: "reddit",
};
const lemmyPost: VisitablePost = {
  id: "lemmy:lemmy.world:post:42",
  commentCount: 7,
  title: "A lemmy post",
  community: { handle: "test@lemmy.world" },
  source: "lemmy",
};

describe("threadVisits", () => {
  it("first visit returns null; revisit returns the prior visit time/count", async () => {
    await initThreadVisits();
    expect(recordVisit(redditPost, 1000)).toBeNull();
    const prev = recordVisit({ ...redditPost, commentCount: 130 }, 5000);
    expect(prev).toMatchObject({ lastVisit: 1000, commentCount: 100 });
    // The stored entry now reflects the latest open.
    expect(getVisit(redditPost.id)).toMatchObject({
      lastVisit: 5000,
      commentCount: 130,
    });
  });

  it("tracks reddit and lemmy posts identically (JanusId-keyed)", async () => {
    await initThreadVisits();
    recordVisit(redditPost, 1000);
    recordVisit(lemmyPost, 2000);
    expect(getVisit(redditPost.id)?.source).toBe("reddit");
    expect(getVisit(lemmyPost.id)?.source).toBe("lemmy");
    const history = listHistory();
    expect(history.map((h) => h.id)).toEqual([lemmyPost.id, redditPost.id]);
  });

  it("history orders by most recent visit and survives a reload", async () => {
    await initThreadVisits();
    recordVisit(redditPost, 1000);
    recordVisit(lemmyPost, 2000);
    recordVisit(redditPost, 3000); // revisit bumps it to the top
    await flushThreadVisits();
    __resetThreadVisits();
    await initThreadVisits();
    expect(listHistory().map((h) => h.id)).toEqual([
      redditPost.id,
      lemmyPost.id,
    ]);
  });

  it("clearHistory empties the store", async () => {
    await initThreadVisits();
    recordVisit(redditPost, 1000);
    clearHistory();
    expect(listHistory()).toEqual([]);
    expect(getVisit(redditPost.id)).toBeUndefined();
  });

  it("evicts the oldest entries past the cap", async () => {
    await initThreadVisits();
    for (let i = 0; i < 650; i++) {
      recordVisit({ ...redditPost, id: `reddit:r:post:${i}` }, i + 1);
    }
    expect(getVisit("reddit:r:post:0")).toBeUndefined();
    expect(getVisit("reddit:r:post:649")).toBeDefined();
    expect(listHistory().length).toBeLessThanOrEqual(600);
  });
});

describe("userTags", () => {
  it("tags reddit and lemmy handles, case-insensitively", async () => {
    await initUserTags();
    setUserTag("u/SomeUser", { label: "GPU expert", color: "#8b7cff" });
    setUserTag("someone@lemmy.world", { label: "mod friend", color: "#18d6a6" });
    expect(getUserTag("u/someuser")?.label).toBe("GPU expert");
    expect(getUserTag("Someone@Lemmy.World")?.label).toBe("mod friend");
  });

  it("empty label removes; removeUserTag removes; persists across reload", async () => {
    await initUserTags();
    setUserTag("u/a", { label: "keep", color: "#8b7cff" });
    setUserTag("u/b", { label: "temp", color: "#8b7cff" });
    setUserTag("u/b", { label: "  ", color: "#8b7cff" }); // blank = clear
    removeUserTag("u/missing"); // no-op, no throw
    await flushUserTags();
    __resetUserTags();
    await initUserTags();
    expect(getUserTag("u/a")?.label).toBe("keep");
    expect(getUserTag("u/b")).toBeUndefined();
  });

  it("clamps labels to 40 chars and bounds the store", async () => {
    await initUserTags();
    setUserTag("u/long", { label: "x".repeat(80), color: "#8b7cff" });
    expect(getUserTag("u/long")?.label).toHaveLength(40);
    for (let i = 0; i < 1005; i++) {
      setUserTag(`u/u${i}`, { label: `t${i}`, color: "#8b7cff" });
    }
    expect(getUserTag("u/u0")).toBeUndefined();
    expect(getUserTag("u/u1004")?.label).toBe("t1004");
  });
});
