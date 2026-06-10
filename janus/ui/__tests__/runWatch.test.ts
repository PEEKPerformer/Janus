import {
  adaptersForWatch,
  runWatch,
  runCommentWatch,
  filterCommentsByQuery,
  unseenIds,
  type WatchAdapters,
} from "../runWatch";
import type { SavedSearch } from "../../app/savedSearches";

const search = (over: Partial<SavedSearch>): SavedSearch => ({
  id: "x",
  kind: "posts",
  query: "q",
  source: "all",
  createdAt: 0,
  lastCheckedAt: 0,
  seenIds: [],
  ...over,
});

const post = (id: string, createdAt: number, dedupKey?: string) =>
  ({ id, createdAt, dedupKey, title: "t" }) as any;

function fakeAdapter(source: "reddit" | "lemmy", items: any[]) {
  return {
    source,
    search: jest.fn(async () => ({ items, nextCursor: undefined })),
  } as any;
}

describe("adaptersForWatch (routing)", () => {
  const reddit = fakeAdapter("reddit", []);
  const lemmy = fakeAdapter("lemmy", []);
  const ctx: WatchAdapters = {
    reddit,
    lemmy,
    adapterForEntity: jest.fn(() => reddit),
  };

  it("global 'all' watch fans out over both networks", () => {
    expect(adaptersForWatch(search({ source: "all" }), ctx)).toEqual([
      reddit,
      lemmy,
    ]);
  });

  it("single-source watches hit just that source", () => {
    expect(adaptersForWatch(search({ source: "reddit" }), ctx)).toEqual([reddit]);
    expect(adaptersForWatch(search({ source: "lemmy" }), ctx)).toEqual([lemmy]);
  });

  it("a community watch routes to the community's origin adapter", () => {
    const s = search({
      source: "lemmy",
      communityId: "lemmy:hexbear.net:community:chat",
    });
    adaptersForWatch(s, ctx);
    expect(ctx.adapterForEntity).toHaveBeenCalledWith({
      source: "lemmy",
      instance: "hexbear.net",
    });
  });
});

describe("runWatch (merge + sort + dedupe)", () => {
  it("merges both sources newest-first and de-dupes federated echoes", async () => {
    const reddit = fakeAdapter("reddit", [post("r1", 300), post("r2", 100)]);
    const lemmy = fakeAdapter("lemmy", [
      post("l1", 200, "ap://same"),
      post("l2", 50, "ap://same"), // duplicate of l1 by dedupKey
    ]);
    const ctx: WatchAdapters = {
      reddit,
      lemmy,
      adapterForEntity: jest.fn(),
    };
    const out = await runWatch(search({ source: "all" }), ctx);
    expect(out.map((p) => p.id)).toEqual(["r1", "l1", "r2"]);
    // Each adapter asked for newest-first in its own dialect.
    expect(reddit.search).toHaveBeenCalledWith(
      "q",
      "posts",
      expect.objectContaining({ sort: "new" }),
    );
    expect(lemmy.search).toHaveBeenCalledWith(
      "q",
      "posts",
      expect.objectContaining({ sort: "New" }),
    );
  });

  it("survives one source failing (still returns the other's hits)", async () => {
    const reddit = fakeAdapter("reddit", [post("r1", 10)]);
    const lemmy = {
      source: "lemmy",
      search: jest.fn(async () => {
        throw new Error("down");
      }),
    } as any;
    const out = await runWatch(search({ source: "all" }), {
      reddit,
      lemmy,
      adapterForEntity: jest.fn(),
    });
    expect(out.map((p) => p.id)).toEqual(["r1"]);
  });
});

describe("unseenIds (the 'N new' diff)", () => {
  it("returns only ids not already seen", () => {
    const results = [post("a", 3), post("b", 2), post("c", 1)];
    expect(unseenIds(["b"], results)).toEqual(["a", "c"]);
    expect(unseenIds(["a", "b", "c"], results)).toEqual([]);
  });
});

const comment = (id: string, body: string, createdAt: number) =>
  ({ id, body: { text: body }, createdAt, author: { handle: "u/x" }, score: 1 }) as any;

describe("filterCommentsByQuery", () => {
  const comments = [
    comment("c1", "Amex Plat 150k approved, 3/24", 300),
    comment("c2", "Anyone know the Hyatt promo?", 200),
    comment("c3", "Got the 150K offer in-branch", 100),
  ];
  it("keeps comments whose body matches, newest first, case-insensitive", () => {
    expect(filterCommentsByQuery(comments, "150k").map((c) => c.id)).toEqual([
      "c1",
      "c3",
    ]);
  });
  it("empty query matches nothing", () => {
    expect(filterCommentsByQuery(comments, "  ")).toEqual([]);
  });
});

describe("runCommentWatch (r/churning datapoint feed)", () => {
  // Megathread series: search resolves the newest edition; we scan its comments.
  const today = post("today", 999);
  today.title = "Daily Question Thread - June 09, 2026";
  const stale = post("stale", 1);
  stale.title = "Daily Question Thread - June 01, 2026";
  const churningComments = [
    comment("c1", "Amex Plat 150k DP: approved", 300),
    comment("c2", "unrelated chatter", 200),
    comment("c3", "another 150K data point", 100),
  ];

  const watch = (): SavedSearch =>
    search({
      kind: "comments",
      query: "150k",
      source: "reddit",
      communityId: "reddit:www.reddit.com:community:churning",
      communityHandle: "r/churning",
      seriesKey: "daily question thread",
      seriesLabel: "Daily Question Thread",
      postId: "stale",
    });

  it("resolves the newest edition then returns only matching comments", async () => {
    const reddit = {
      source: "reddit",
      search: jest.fn(async () => ({ items: [stale, today] })),
      getPost: jest.fn(async (id: string) => (id === "today" ? today : stale)),
      getComments: jest.fn(async () => ({ items: churningComments })),
    } as any;
    const ctx: WatchAdapters = {
      reddit,
      lemmy: {} as any,
      adapterForEntity: jest.fn(() => reddit),
    };
    const { post: edition, matches } = await runCommentWatch(watch(), ctx);
    // Newest edition was picked for the comment fetch…
    expect(reddit.getComments).toHaveBeenCalledWith("today", expect.anything());
    expect(edition.id).toBe("today");
    // …and only datapoint comments survive, newest first.
    expect(matches.map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("falls back to the stored thread if the series search fails", async () => {
    const reddit = {
      source: "reddit",
      search: jest.fn(async () => {
        throw new Error("search down");
      }),
      getPost: jest.fn(async () => stale),
      getComments: jest.fn(async () => ({ items: churningComments })),
    } as any;
    const ctx: WatchAdapters = {
      reddit,
      lemmy: {} as any,
      adapterForEntity: jest.fn(() => reddit),
    };
    const { matches } = await runCommentWatch(watch(), ctx);
    expect(reddit.getComments).toHaveBeenCalledWith("stale", expect.anything());
    expect(matches.map((c) => c.id)).toEqual(["c1", "c3"]);
  });
});
