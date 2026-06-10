import { buildBriefing, briefingNewsCount } from "../briefing";
import {
  followSeries,
  __resetThreadSeries,
  seriesKeyForTitle,
} from "../../app/threadSeries";
import {
  addSearch,
  markChecked,
  __resetSavedSearches,
} from "../../app/savedSearches";
import { recordVisit, __resetThreadVisits } from "../../app/threadVisits";

const COMMUNITY = "reddit:www.reddit.com:community:churning";
const TITLE = "Daily Question Thread - June 10, 2026";

const edition = (nativeId: string, commentCount: number) =>
  ({
    id: `reddit:www.reddit.com:post:${nativeId}`,
    title: TITLE,
    source: "reddit",
    instance: "www.reddit.com",
    community: { id: COMMUNITY, handle: "r/churning" },
    commentCount,
    createdAt: 500,
    media: [],
  }) as any;

const comment = (id: string, body: string, score: number, createdAt: number) =>
  ({
    id: `reddit:www.reddit.com:comment:${id}`,
    body: { text: body },
    score,
    createdAt,
    author: { handle: "u/dp" },
  }) as any;

function ctxWith(post: any, comments: any[]) {
  const adapter = {
    source: "reddit",
    instance: "www.reddit.com",
    search: jest.fn(async () => ({ items: [post], nextCursor: undefined })),
    getComments: jest.fn(async () => ({
      items: comments,
      nextCursor: undefined,
    })),
  } as any;
  return {
    adapter,
    ctx: {
      reddit: adapter,
      lemmy: adapter,
      adapterForEntity: jest.fn(() => adapter),
    },
  };
}

const follow = () =>
  followSeries(
    {
      title: TITLE,
      source: "reddit",
      community: { id: COMMUNITY, handle: "r/churning" },
    },
    1,
  );

const instant = { sleep: async () => {}, paceMs: 0 };

afterEach(() => {
  __resetThreadSeries();
  __resetSavedSearches();
  __resetThreadVisits();
});

describe("buildBriefing", () => {
  it("a never-opened edition briefs as NEW with its full comment count", async () => {
    follow();
    const { ctx } = ctxWith(edition("today", 42), []);
    const [b] = await buildBriefing(ctx, instant);
    expect(b.edition?.id).toBe("reddit:www.reddit.com:post:today");
    expect(b.newEdition).toBe(true);
    expect(b.newComments).toBe(42);
    expect(briefingNewsCount([b])).toBe(1);
  });

  it("a visited edition briefs the comment delta since YOUR visit", async () => {
    follow();
    const post = edition("today", 50);
    recordVisit(post, 100);
    const { ctx } = ctxWith({ ...post, commentCount: 62 }, []);
    const [b] = await buildBriefing(ctx, instant);
    expect(b.newEdition).toBe(false);
    expect(b.newComments).toBe(12);
  });

  it("caught up: visited, no growth, no unseen — zero news", async () => {
    follow();
    const post = edition("today", 50);
    recordVisit(post, 100);
    const { ctx } = ctxWith(post, []);
    const [b] = await buildBriefing(ctx, instant);
    expect(b.newComments).toBe(0);
    expect(briefingNewsCount([b])).toBe(0);
  });

  it("attaches the series' comment watches with unseen counts", async () => {
    follow();
    const post = edition("today", 5);
    recordVisit(post, 100);
    addSearch({
      kind: "comments",
      query: "amex",
      source: "reddit",
      communityId: COMMUNITY,
      communityHandle: "r/churning",
      seriesKey: seriesKeyForTitle(TITLE),
      seriesLabel: "Daily Question Thread",
      postId: post.id,
    });
    const seen = comment("old", "amex offer", 5, 50);
    const fresh = comment("new", "new amex datapoint", 9, 150);
    const { ctx } = ctxWith(post, [seen, fresh]);

    // Mark the older match as already seen.
    const first = await buildBriefing(ctx, instant);
    markChecked(first[0].watches[0].watch.id, [seen.id]);

    const [b] = await buildBriefing(ctx, instant);
    expect(b.watches).toHaveLength(1);
    expect(b.watches[0].matches).toHaveLength(2);
    expect(b.watches[0].unseen).toBe(1); // only the fresh datapoint
    expect(briefingNewsCount([b])).toBe(1);
  });

  it("topNew surfaces the highest-scored comments SINCE your last visit", async () => {
    follow();
    const post = edition("today", 5);
    recordVisit(post, 100); // lastVisit baseline = 100
    const { ctx } = ctxWith(post, [
      comment("a", "old banger", 999, 50), // before your visit — excluded
      comment("b", "meh", 1, 150),
      comment("c", "big datapoint", 80, 160),
      comment("d", "good one", 40, 170),
      comment("e", "ok", 7, 180),
    ]);
    const [b] = await buildBriefing(ctx, { ...instant, topCount: 3 });
    expect(b.topNew.map((c: any) => c.body.text)).toEqual([
      "big datapoint",
      "good one",
      "ok",
    ]);
  });

  it("a failed resolution still yields a row (marked unresolved), not a crash", async () => {
    follow();
    const { ctx, adapter } = ctxWith(edition("today", 5), []);
    adapter.search.mockRejectedValueOnce(new Error("offline"));
    const [b] = await buildBriefing(ctx, instant);
    expect(b.edition).toBeNull();
    expect(b.newEdition).toBe(false);
    expect(briefingNewsCount([b])).toBe(0);
  });
});

describe("topNew thread filtering", () => {
  it("only ROOT comments brief — replies live in the thread itself", async () => {
    follow();
    const post = edition("today", 5);
    recordVisit(post, 100);
    const root = comment("root", "big datapoint", 50, 150);
    const reply = {
      ...comment("reply", "nested reply", 500, 160),
      parentId: root.id,
    };
    const { ctx } = ctxWith(post, [root, reply]);
    const [b] = await buildBriefing(ctx, instant);
    expect(b.topNew.map((c: any) => c.id)).toEqual([root.id]);
  });
});
