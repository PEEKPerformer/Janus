import {
  adaptersForWatch,
  runWatch,
  unseenIds,
  type WatchAdapters,
} from "../runWatch";
import type { SavedSearch } from "../../app/savedSearches";

const search = (over: Partial<SavedSearch>): SavedSearch => ({
  id: "x",
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
