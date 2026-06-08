import {
  interleave,
  weightedInterleaveN,
  createUnifiedFeed,
} from "../unifiedFeed";
import type { AdapterMap } from "../AdapterContext";
import type { Post } from "../../core/model";
import type { Page } from "../../core/pagination";

function post(id: string, source: "reddit" | "lemmy"): Post {
  return { id, source, title: id } as unknown as Post;
}

/** Build an AdapterMap whose getFeed returns scripted pages keyed by cursor. */
function makeAdapters(
  reddit: (cursor: unknown) => Promise<Page<Post>> | Page<Post>,
  lemmy: (cursor: unknown) => Promise<Page<Post>> | Page<Post>,
): { adapters: AdapterMap; redditCalls: unknown[]; lemmyCalls: unknown[] } {
  const redditCalls: unknown[] = [];
  const lemmyCalls: unknown[] = [];
  const adapters = {
    reddit: {
      getFeed: async (_q: unknown, page: { cursor?: unknown }) => {
        redditCalls.push(page.cursor);
        return reddit(page.cursor);
      },
    },
    lemmy: {
      getFeed: async (_q: unknown, page: { cursor?: unknown }) => {
        lemmyCalls.push(page.cursor);
        return lemmy(page.cursor);
      },
    },
  } as unknown as AdapterMap;
  return { adapters, redditCalls, lemmyCalls };
}

describe("interleave", () => {
  it("round-robins, preserving each input's order and length", () => {
    expect(interleave([1, 3, 5], [2, 4])).toEqual([1, 2, 3, 4, 5]);
    expect(interleave([], [1, 2])).toEqual([1, 2]);
    expect(interleave([1, 2], [])).toEqual([1, 2]);
  });
});

describe("weightedInterleaveN", () => {
  it("takes `weight` items from each list per cycle (3:1 biases the first)", () => {
    const r = ["r1", "r2", "r3", "r4", "r5", "r6"];
    const l = ["l1", "l2"];
    expect(weightedInterleaveN([r, l], [3, 1])).toEqual([
      "r1",
      "r2",
      "r3",
      "l1",
      "r4",
      "r5",
      "r6",
      "l2",
    ]);
  });

  it("with all weights 1, matches a plain round-robin", () => {
    expect(weightedInterleaveN([[1, 3], [2, 4]], [1, 1])).toEqual([1, 2, 3, 4]);
  });

  it("appends leftovers and treats missing/zero weights as 1", () => {
    expect(weightedInterleaveN([["a", "b", "c"], ["x"]], [2, 0])).toEqual([
      "a",
      "b",
      "x",
      "c",
    ]);
  });
});

describe("createUnifiedFeed", () => {
  it("merges the first page from both sources and encodes both cursors", async () => {
    const { adapters } = makeAdapters(
      () => ({
        items: [post("r1", "reddit"), post("r2", "reddit")],
        nextCursor: "rC2",
      }),
      () => ({ items: [post("l1", "lemmy")], nextCursor: "lC2" }),
    );
    const fetchPage = createUnifiedFeed(adapters, { sort: "hot" });
    const page = await fetchPage({ limit: 25 });
    expect(page.items.map((p) => p.id)).toEqual(["r1", "l1", "r2"]); // round-robin
    expect(JSON.parse(page.nextCursor as string)).toEqual({
      r: "rC2",
      l: "lC2",
    });
  });

  it("threads each source's cursor and skips an exhausted source", async () => {
    const { adapters, redditCalls, lemmyCalls } = makeAdapters(
      (c) => ({ items: [post(`r@${c}`, "reddit")], nextCursor: "rC3" }),
      (c) => ({ items: [post(`l@${c}`, "lemmy")], nextCursor: "lC3" }),
    );
    const fetchPage = createUnifiedFeed(adapters, {});
    // lemmy already exhausted (null), reddit continues from rC2.
    const page = await fetchPage({
      cursor: JSON.stringify({ r: "rC2", l: null }),
      limit: 25,
    });
    expect(redditCalls).toEqual(["rC2"]);
    expect(lemmyCalls).toEqual([]); // skipped — not refetched from the top
    expect(page.items.map((p) => p.id)).toEqual(["r@rC2"]);
    expect(JSON.parse(page.nextCursor as string)).toEqual({
      r: "rC3",
      l: null,
    });
  });

  it("ends the feed when both sources are exhausted", async () => {
    const { adapters } = makeAdapters(
      () => ({ items: [post("r1", "reddit")] }), // no nextCursor
      () => ({ items: [post("l1", "lemmy")] }),
    );
    const fetchPage = createUnifiedFeed(adapters, {});
    const page = await fetchPage({ limit: 25 });
    expect(page.nextCursor).toBeUndefined();
  });

  it("survives one source failing — shows the other", async () => {
    const { adapters } = makeAdapters(
      () => {
        throw new Error("reddit needs login");
      },
      () => ({ items: [post("l1", "lemmy")], nextCursor: "lC2" }),
    );
    const fetchPage = createUnifiedFeed(adapters, {});
    const page = await fetchPage({ limit: 25 });
    expect(page.items.map((p) => p.id)).toEqual(["l1"]);
    // reddit marked exhausted so it won't keep being retried every page.
    expect(JSON.parse(page.nextCursor as string)).toEqual({
      r: null,
      l: "lC2",
    });
  });

  it("throws only when every attempted source fails", async () => {
    const { adapters } = makeAdapters(
      () => {
        throw new Error("reddit down");
      },
      () => {
        throw new Error("lemmy down");
      },
    );
    const fetchPage = createUnifiedFeed(adapters, {});
    await expect(fetchPage({ limit: 25 })).rejects.toThrow(/down/);
  });
});
