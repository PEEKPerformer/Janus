import { listingFor, buildAggregateSpecs } from "../feedSources";
import { createAggregateFeed, interleaveN } from "../unifiedFeed";
import type { SourceAdapter } from "../../core/adapter";
import type { Post } from "../../core/model";
import type { Page } from "../../core/pagination";

function adapter(
  source: "reddit" | "lemmy",
  instance: string,
  getFeed: (q: unknown, p: { cursor?: unknown }) => Promise<Page<Post>>,
): SourceAdapter {
  return { source, instance, getFeed } as unknown as SourceAdapter;
}

function post(id: string): Post {
  return { id, title: id } as unknown as Post;
}

describe("listingFor", () => {
  it("maps each mode onto native listings", () => {
    expect(listingFor("reddit", "subscribed")).toBe("home");
    expect(listingFor("reddit", "all")).toBe("popular");
    expect(listingFor("reddit", "local")).toBeNull(); // Reddit has no local
    expect(listingFor("lemmy", "subscribed")).toBe("Subscribed");
    expect(listingFor("lemmy", "all")).toBe("All");
    expect(listingFor("lemmy", "local")).toBe("Local");
  });
});

describe("buildAggregateSpecs", () => {
  const noop = async () => ({ items: [] });
  const reddit = adapter("reddit", "www.reddit.com", noop);
  const hex = adapter("lemmy", "hexbear.net", noop);
  const ml = adapter("lemmy", "lemmy.ml", noop);

  it("one spec per applicable source, keyed by origin", () => {
    const specs = buildAggregateSpecs([reddit, hex, ml], "all", {});
    expect(specs.map((s) => s.key)).toEqual([
      "reddit:www.reddit.com",
      "lemmy:hexbear.net",
      "lemmy:lemmy.ml",
    ]);
    expect(specs.map((s) => s.query.listingType)).toEqual([
      "popular",
      "All",
      "All",
    ]);
  });

  it("drops Reddit from a Local view but keeps every Lemmy instance", () => {
    const specs = buildAggregateSpecs([reddit, hex, ml], "local", {});
    expect(specs.map((s) => s.key)).toEqual([
      "lemmy:hexbear.net",
      "lemmy:lemmy.ml",
    ]);
    expect(specs.every((s) => s.query.listingType === "Local")).toBe(true);
  });

  it("threads sort + timeWindow into every query", () => {
    const specs = buildAggregateSpecs([hex, ml], "subscribed", {
      sort: "top",
      timeWindow: "week",
    });
    expect(specs.every((s) => s.query.sort === "top")).toBe(true);
    expect(specs.every((s) => s.query.timeWindow === "week")).toBe(true);
  });
});

describe("createAggregateFeed across 3 instances", () => {
  it("round-robins all three and threads independent cursors", async () => {
    const mk = (inst: string, prefix: string, next: string | undefined) =>
      adapter("lemmy", inst, async () => ({
        items: [post(`${prefix}1`), post(`${prefix}2`)],
        nextCursor: next,
      }));
    const specs = buildAggregateSpecs(
      [
        mk("hexbear.net", "h", "hC"),
        mk("lemmy.ml", "m", undefined), // exhausted immediately
        mk("lemmygrad.ml", "g", "gC"),
      ],
      "all",
      {},
    );
    const page = await createAggregateFeed(specs)({ limit: 25 });
    expect(page.items.map((p) => p.id)).toEqual([
      "h1",
      "m1",
      "g1",
      "h2",
      "m2",
      "g2",
    ]);
    const cc = JSON.parse(page.nextCursor as string);
    expect(cc).toEqual({
      "lemmy:hexbear.net": "hC",
      "lemmy:lemmy.ml": null,
      "lemmy:lemmygrad.ml": "gC",
    });
  });

  it("ends only when every source is exhausted", async () => {
    const specs = buildAggregateSpecs(
      [
        adapter("lemmy", "a.net", async () => ({ items: [post("a")] })),
        adapter("lemmy", "b.net", async () => ({ items: [post("b")] })),
      ],
      "all",
      {},
    );
    const page = await createAggregateFeed(specs)({ limit: 25 });
    expect(page.nextCursor).toBeUndefined();
  });
});

describe("interleaveN", () => {
  it("round-robins N lists preserving order", () => {
    expect(
      interleaveN([
        [1, 4],
        [2, 5, 7],
        [3, 6],
      ]),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
