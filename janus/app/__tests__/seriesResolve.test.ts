import { resolveSeriesEdition } from "../seriesResolve";
import { looksLikeRecurringTitle, seriesKeyForTitle } from "../threadSeries";
import type { Post } from "../../core/model";

const COMMUNITY = "reddit:www.reddit.com:community:churning";
const WEEKLY =
  "Trip Reports and Churning Success Stories Weekly Thread - Week of June 08, 2026";

const post = (nativeId: string, title: string, createdAt: number): Post =>
  ({
    id: `reddit:www.reddit.com:post:${nativeId}`,
    title,
    createdAt,
    source: "reddit",
    instance: "www.reddit.com",
    community: { id: COMMUNITY, handle: "r/churning" },
    commentCount: 1,
    media: [],
  }) as unknown as Post;

const adapterWith = (over: any = {}) =>
  ({
    source: "reddit",
    instance: "www.reddit.com",
    search: jest.fn(async () => ({ items: [], nextCursor: undefined })),
    getFeed: jest.fn(async () => ({ items: [], nextCursor: undefined })),
    ...over,
  }) as any;

describe("resolveSeriesEdition (weekly-proof, two-stage)", () => {
  const key = seriesKeyForTitle(WEEKLY);

  it("search hit short-circuits — no feed scan", async () => {
    const hit = post("w2", WEEKLY.replace("June 08", "June 15"), 200);
    const adapter = adapterWith({
      search: jest.fn(async () => ({ items: [hit], nextCursor: undefined })),
    });
    await expect(
      resolveSeriesEdition(adapter, COMMUNITY, "Trip Reports Weekly", key),
    ).resolves.toMatchObject({ id: hit.id });
    expect(adapter.getFeed).not.toHaveBeenCalled();
  });

  it("shortens long labels to a searchable query", async () => {
    const adapter = adapterWith();
    const longLabel =
      "Trip Reports and Churning Success Stories Weekly Thread Week of";
    await resolveSeriesEdition(adapter, COMMUNITY, longLabel, key);
    expect(adapter.search).toHaveBeenCalledWith(
      "Trip Reports and Churning Success", // first 5 tokens
      "posts",
      expect.objectContaining({ communityId: COMMUNITY }),
    );
  });

  it("empty search results fall back to scanning the community's new feed", async () => {
    const weekly = post("w2", WEEKLY.replace("June 08", "June 15"), 200);
    const adapter = adapterWith({
      getFeed: jest.fn(async () => ({
        items: [post("x", "One-off post", 300), weekly],
        nextCursor: undefined,
      })),
    });
    await expect(
      resolveSeriesEdition(adapter, COMMUNITY, "anything", key),
    ).resolves.toMatchObject({ id: weekly.id });
    expect(adapter.getFeed).toHaveBeenCalledWith(
      { communityId: COMMUNITY, sort: "new" },
      { limit: 100 },
    );
  });

  it("a throwing search still resolves through the feed scan", async () => {
    const weekly = post("w2", WEEKLY, 200);
    const adapter = adapterWith({
      search: jest.fn(async () => {
        throw new Error("search down");
      }),
      getFeed: jest.fn(async () => ({
        items: [weekly],
        nextCursor: undefined,
      })),
    });
    await expect(
      resolveSeriesEdition(adapter, COMMUNITY, "anything", key),
    ).resolves.toMatchObject({ id: weekly.id });
  });

  it("throws only when BOTH stages fail on transport", async () => {
    const adapter = adapterWith({
      search: jest.fn(async () => {
        throw new Error("search down");
      }),
      getFeed: jest.fn(async () => {
        throw new Error("feed down");
      }),
    });
    await expect(
      resolveSeriesEdition(adapter, COMMUNITY, "anything", key),
    ).rejects.toThrow("search down");
  });
});

describe("looksLikeRecurringTitle (follow-action gating)", () => {
  it("recurring shapes qualify", () => {
    expect(
      looksLikeRecurringTitle("Daily Question Thread - June 10, 2026"),
    ).toBe(true);
    expect(looksLikeRecurringTitle(WEEKLY)).toBe(true);
    expect(looksLikeRecurringTitle("Weekly Off Topic Megathread")).toBe(true); // keyword, no date
    expect(
      looksLikeRecurringTitle("Game Thread: Lakers @ Celtics 03/22/26"),
    ).toBe(true);
  });

  it("one-off posts don't", () => {
    expect(looksLikeRecurringTitle("My churning success story")).toBe(false);
    expect(looksLikeRecurringTitle("What card should I get next?")).toBe(false);
    expect(looksLikeRecurringTitle("Rant")).toBe(false); // single token
  });
});
