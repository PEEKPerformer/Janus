import NetInfo from "@react-native-community/netinfo";
import type { Post } from "../../core/model";

import {
  initOffline,
  isOffline,
  subscribeOffline,
  __setOffline,
  __resetOffline,
} from "../offline";
import {
  beginPack,
  upsertPackedItem,
  savePackedPost,
  getPackedPost,
  getPackManifest,
  listPackedItems,
  packedCount,
  clearPack,
  type PackedItem,
} from "../offlinePack";
import {
  enqueueVote,
  enqueueComment,
  listOutbox,
  outboxCount,
  removeOutboxEntry,
  clearOutbox,
  drainOutbox,
} from "../outbox";
import { runPack, imageUrlsFor, estimatePackTotal } from "../packer";
import {
  defaultCommentSortFor,
  resolveCommentSort,
} from "../commentSortResolve";
import { getCommunitySort } from "../communityPrefs";
import { COMMENTS_CACHE, commentsCacheKey } from "../contentCaches";
import { addReadLater, __resetReadLater } from "../readLater";
import { followSeries, __resetThreadSeries } from "../threadSeries";
import { Vote } from "../../core/vote";

jest.mock("../communityPrefs", () => ({
  getCommunitySort: jest.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rPost = (nativeId: string, over: Partial<Post> = {}): Post =>
  ({
    id: `reddit:www.reddit.com:post:${nativeId}`,
    dedupKey: `reddit:${nativeId}`,
    source: "reddit",
    instance: "www.reddit.com",
    title: `Post ${nativeId}`,
    community: {
      id: "reddit:www.reddit.com:community:churning",
      handle: "r/churning",
    },
    commentCount: 5,
    createdAt: 100,
    media: [],
    ...over,
  }) as unknown as Post;

const lPost = (nativeId: string, over: Partial<Post> = {}): Post =>
  ({
    id: `lemmy:lemmy.world:post:${nativeId}`,
    dedupKey: `https://lemmy.world/post/${nativeId}`,
    source: "lemmy",
    instance: "lemmy.world",
    title: `Lemmy post ${nativeId}`,
    community: { id: "lemmy:lemmy.world:community:tech", handle: "tech" },
    commentCount: 3,
    createdAt: 90,
    media: [],
    ...over,
  }) as unknown as Post;

function fakeAdapter(source: "reddit" | "lemmy", over: any = {}) {
  return {
    source,
    instance: source === "reddit" ? "www.reddit.com" : "lemmy.world",
    capabilities: {
      sorts: {
        feed: [{ id: source === "reddit" ? "hot" : "Active" }],
        comment: [{ id: source === "reddit" ? "top" : "Top" }],
      },
    },
    getPost: jest.fn(async (id: string) =>
      source === "reddit"
        ? rPost(id.split(":").pop()!)
        : lPost(id.split(":").pop()!),
    ),
    getComments: jest.fn(async () => ({
      items: [{ id: "c1" }],
      nextCursor: undefined,
    })),
    getFeed: jest.fn(async () => ({ items: [], nextCursor: undefined })),
    search: jest.fn(async () => ({ items: [], nextCursor: undefined })),
    vote: jest.fn(async () => ({ score: 1, userVote: 1 })),
    submitComment: jest.fn(async () => ({ id: "new" })),
    ...over,
  } as any;
}

const ctx = (reddit: any, lemmy: any) => ({
  reddit,
  lemmy,
  adapterForEntity: jest.fn((e: { source: string }) =>
    e.source === "reddit" ? reddit : lemmy,
  ),
});

const instantDeps = (reddit: any, lemmy: any, over: any = {}) => ({
  ...ctx(reddit, lemmy),
  resolveSort: jest.fn(async (a: any) =>
    a.source === "reddit" ? "top" : "Top",
  ),
  prefetchImage: jest.fn(async () => true),
  sleep: async () => {},
  now: () => 1_000,
  ...over,
});

afterEach(() => {
  __resetOffline();
  __resetReadLater();
  __resetThreadSeries();
  clearOutbox();
  clearPack();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// offline store
// ---------------------------------------------------------------------------

describe("offline store", () => {
  it("treats only isConnected === false as offline", () => {
    initOffline();
    const handler = (NetInfo.addEventListener as jest.Mock).mock.calls[0][0];
    expect(isOffline()).toBe(false);
    handler({ isConnected: false });
    expect(isOffline()).toBe(true);
    handler({ isConnected: null }); // unknown -> assume online
    expect(isOffline()).toBe(false);
    handler({ isConnected: true });
    expect(isOffline()).toBe(false);
  });

  it("notifies subscribers on flips and honours unsubscribe", () => {
    const seen: boolean[] = [];
    const unsub = subscribeOffline((o) => seen.push(o));
    __setOffline(true);
    __setOffline(true); // no-op, no duplicate event
    __setOffline(false);
    unsub();
    __setOffline(true);
    expect(seen).toEqual([true, false]);
  });
});

// ---------------------------------------------------------------------------
// pack manifest
// ---------------------------------------------------------------------------

describe("offlinePack manifest", () => {
  const item = (id: string, status: PackedItem["status"]): PackedItem => ({
    id,
    title: "t",
    community: "r/x",
    source: "reddit",
    commentCount: 1,
    origin: "readLater",
    status,
  });

  it("round-trips manifest rows and post snapshots", () => {
    beginPack(123);
    upsertPackedItem(item("a", "packed"));
    const post = rPost("abc");
    savePackedPost(post);
    expect(getPackManifest()?.packedAt).toBe(123);
    expect(listPackedItems()).toHaveLength(1);
    expect(getPackedPost(post.id)?.title).toBe("Post abc");
  });

  it("upsert replaces a row with the same id", () => {
    beginPack(1);
    upsertPackedItem(item("a", "partial"));
    upsertPackedItem(item("a", "packed"));
    expect(listPackedItems()).toHaveLength(1);
    expect(listPackedItems()[0].status).toBe("packed");
  });

  it("packedCount excludes failed rows", () => {
    beginPack(1);
    upsertPackedItem(item("a", "packed"));
    upsertPackedItem(item("b", "failed"));
    expect(packedCount()).toBe(1);
  });

  it("clearPack drops the manifest and its snapshots", () => {
    beginPack(1);
    const post = rPost("abc");
    upsertPackedItem(item(post.id, "packed"));
    savePackedPost(post);
    clearPack();
    expect(getPackManifest()).toBeNull();
    expect(getPackedPost(post.id)).toBeNull();
  });

  it("beginPack wipes the previous pack", () => {
    beginPack(1);
    upsertPackedItem(item("a", "packed"));
    beginPack(2);
    expect(listPackedItems()).toEqual([]);
    expect(getPackManifest()?.packedAt).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// outbox
// ---------------------------------------------------------------------------

describe("outbox", () => {
  it("re-voting the same target overwrites (last-write-wins)", () => {
    enqueueVote("reddit:www.reddit.com:post:a", Vote.Up, 1);
    enqueueVote("reddit:www.reddit.com:post:a", Vote.Down, 2);
    expect(outboxCount()).toBe(1);
    const entry = listOutbox()[0];
    expect(entry.action.kind === "vote" && entry.action.vote).toBe(Vote.Down);
  });

  it("comments append (never coalesce) and list oldest-first", () => {
    enqueueComment(
      { postId: "p", parentId: "p", markdown: "one", postTitle: "T" },
      5,
    );
    enqueueComment(
      { postId: "p", parentId: "p", markdown: "two", postTitle: "T" },
      3,
    );
    expect(outboxCount()).toBe(2);
    const bodies = listOutbox().map(
      (e) => e.action.kind === "comment" && e.action.markdown,
    );
    expect(bodies).toEqual(["two", "one"]);
  });

  it("drain sends through the owning adapter and removes successes", async () => {
    const reddit = fakeAdapter("reddit");
    const lemmy = fakeAdapter("lemmy");
    const { adapterForEntity } = ctx(reddit, lemmy);
    enqueueVote("reddit:www.reddit.com:post:a", Vote.Up, 1);
    enqueueComment(
      {
        postId: "lemmy:lemmy.world:post:9",
        parentId: "lemmy:lemmy.world:post:9",
        markdown: "hi",
        postTitle: "T",
      },
      2,
    );
    const result = await drainOutbox(adapterForEntity);
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(reddit.vote).toHaveBeenCalledWith(
      "reddit:www.reddit.com:post:a",
      Vote.Up,
    );
    expect(lemmy.submitComment).toHaveBeenCalledWith({
      postId: "lemmy:lemmy.world:post:9",
      parentId: "lemmy:lemmy.world:post:9",
      markdown: "hi",
    });
    expect(outboxCount()).toBe(0);
  });

  it("failures stay queued (marked failed) and retry on the next drain", async () => {
    const reddit = fakeAdapter("reddit", {
      vote: jest
        .fn()
        .mockRejectedValueOnce(new Error("503"))
        .mockResolvedValueOnce({ score: 1, userVote: 1 }),
    });
    const { adapterForEntity } = ctx(reddit, fakeAdapter("lemmy"));
    enqueueVote("reddit:www.reddit.com:post:a", Vote.Up, 1);

    const first = await drainOutbox(adapterForEntity);
    expect(first).toEqual({ sent: 0, failed: 1 });
    expect(listOutbox()[0].status).toBe("failed");
    expect(listOutbox()[0].error).toBe("503");

    const second = await drainOutbox(adapterForEntity);
    expect(second).toEqual({ sent: 1, failed: 0 });
    expect(outboxCount()).toBe(0);
  });

  it("removeOutboxEntry discards a queued action", () => {
    enqueueVote("reddit:www.reddit.com:post:a", Vote.Up, 1);
    removeOutboxEntry(listOutbox()[0].id);
    expect(outboxCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// packer
// ---------------------------------------------------------------------------

describe("imageUrlsFor", () => {
  it("packs thumbnail, stills and capped gallery; videos poster-only", () => {
    const post = rPost("a", {
      thumbnail: {
        kind: "image",
        url: "https://t/full",
        thumbnailUrl: "https://t/small",
        isNSFW: false,
      },
      media: [
        { kind: "image", url: "https://img/1", isNSFW: false },
        { kind: "gallery", url: "https://g/1", isNSFW: false },
        { kind: "gallery", url: "https://g/2", isNSFW: false },
        {
          kind: "video",
          url: "https://v/stream",
          thumbnailUrl: "https://v/poster",
          isNSFW: false,
        },
      ],
    } as Partial<Post>);
    const urls = imageUrlsFor(post, 1);
    expect(urls).toContain("https://t/small");
    expect(urls).toContain("https://img/1");
    expect(urls).toContain("https://g/1");
    expect(urls).not.toContain("https://g/2"); // gallery cap
    expect(urls).toContain("https://v/poster");
    expect(urls).not.toContain("https://v/stream"); // streams don't pack
  });

  it("skips non-http urls and de-dupes", () => {
    const post = rPost("a", {
      media: [
        {
          kind: "image",
          url: "https://img/1",
          thumbnailUrl: "https://img/1",
          isNSFW: false,
        },
        { kind: "image", url: "file:///local", isNSFW: false },
      ],
    } as Partial<Post>);
    expect(imageUrlsFor(post)).toEqual(["https://img/1"]);
  });
});

describe("runPack", () => {
  it("packs the read-later queue: comments into the shared cache under PostScreen's key, snapshot saved, images prefetched", async () => {
    const target = rPost("abc", {
      media: [{ kind: "image", url: "https://img/1", isNSFW: false }],
    } as Partial<Post>);
    const reddit = fakeAdapter("reddit", {
      getPost: jest.fn(async () => target),
    });
    const deps = instantDeps(reddit, fakeAdapter("lemmy"));
    addReadLater(target as any, 1);

    const summary = await runPack(
      { readLater: true, series: false, feedSnapshot: false },
      deps,
    );

    expect(summary).toEqual({
      total: 1,
      packed: 1,
      partial: 0,
      failed: 0,
      cancelled: false,
    });
    expect(reddit.getComments).toHaveBeenCalledWith(target.id, {
      sort: "top",
      limit: 100,
    });
    const cached = COMMENTS_CACHE.read(
      commentsCacheKey("reddit", target.id, "top"),
      1_000,
      60_000,
    );
    expect(cached?.value).toEqual({
      items: [{ id: "c1" }],
      nextCursor: undefined,
    });
    expect(getPackedPost(target.id)?.id).toBe(target.id);
    expect(deps.prefetchImage).toHaveBeenCalledWith("https://img/1");
    expect(listPackedItems()[0]).toMatchObject({
      origin: "readLater",
      status: "packed",
    });
  });

  it("resolves the newest edition of a followed series", async () => {
    const old = rPost("old", {
      title: "Daily Question Thread - June 08, 2026",
      createdAt: 1,
    } as Partial<Post>);
    const fresh = rPost("new", {
      title: "Daily Question Thread - June 09, 2026",
      createdAt: 2,
    } as Partial<Post>);
    const reddit = fakeAdapter("reddit", {
      search: jest.fn(async () => ({
        items: [old, fresh],
        nextCursor: undefined,
      })),
    });
    const deps = instantDeps(reddit, fakeAdapter("lemmy"));
    followSeries(
      {
        title: "Daily Question Thread - June 08, 2026",
        source: "reddit",
        community: {
          id: "reddit:www.reddit.com:community:churning",
          handle: "r/churning",
        },
      },
      1,
    );

    const summary = await runPack(
      { readLater: false, series: true, feedSnapshot: false },
      deps,
    );
    expect(summary.packed).toBe(1);
    expect(getPackedPost(fresh.id)).not.toBeNull();
    expect(getPackedPost(old.id)).toBeNull();
    expect(listPackedItems()[0].origin).toBe("series");
  });

  it("feed snapshot pulls both networks and de-dupes against earlier origins", async () => {
    const shared = rPost("dup");
    const reddit = fakeAdapter("reddit", {
      getPost: jest.fn(async () => shared),
      getFeed: jest.fn(async () => ({
        items: [shared, rPost("r2")],
        nextCursor: undefined,
      })),
    });
    const lemmy = fakeAdapter("lemmy", {
      getFeed: jest.fn(async () => ({
        items: [lPost("9")],
        nextCursor: undefined,
      })),
    });
    const deps = instantDeps(reddit, lemmy);
    addReadLater(shared as any, 1); // also in the feed -> packs once, as readLater

    const summary = await runPack(
      { readLater: true, series: false, feedSnapshot: true },
      deps,
    );
    expect(summary.total).toBe(3); // dup folded
    expect(reddit.getFeed).toHaveBeenCalledWith(
      { listingType: "home", sort: "hot" },
      { limit: 50 },
    );
    expect(lemmy.getFeed).toHaveBeenCalledWith(
      { listingType: "Subscribed", sort: "Active" },
      { limit: 50 },
    );
    const dup = listPackedItems().find((i) => i.id === shared.id);
    expect(dup?.origin).toBe("readLater");
  });

  it("comment failures mark the item partial; unreachable read-later posts mark failed", async () => {
    const ok = rPost("ok");
    const reddit = fakeAdapter("reddit", {
      getPost: jest.fn(async (id: string) => {
        if (id.endsWith("gone")) throw new Error("deleted");
        return ok;
      }),
      getComments: jest.fn(async () => {
        throw new Error("503");
      }),
    });
    const deps = instantDeps(reddit, fakeAdapter("lemmy"));
    addReadLater(ok as any, 1);
    addReadLater(rPost("gone") as any, 2);

    const summary = await runPack(
      { readLater: true, series: false, feedSnapshot: false },
      deps,
    );
    expect(summary).toMatchObject({ packed: 0, partial: 1, failed: 1 });
    const items = listPackedItems();
    expect(items.find((i) => i.id === ok.id)?.status).toBe("partial");
    expect(items.find((i) => i.id.endsWith("gone"))?.status).toBe("failed");
  });

  it("shouldStop cancels between items", async () => {
    const reddit = fakeAdapter("reddit", {
      getFeed: jest.fn(async () => ({
        items: [rPost("a"), rPost("b"), rPost("c")],
        nextCursor: undefined,
      })),
    });
    let packedSoFar = 0;
    const deps = instantDeps(reddit, fakeAdapter("lemmy"), {
      onProgress: (p: any) => {
        if (p.phase === "pack") packedSoFar = p.done;
      },
      shouldStop: () => packedSoFar >= 1,
    });
    const summary = await runPack(
      { readLater: false, series: false, feedSnapshot: true },
      deps,
    );
    expect(summary.cancelled).toBe(true);
    expect(summary.packed).toBe(1);
  });

  it("estimatePackTotal counts the chosen scope", () => {
    addReadLater(rPost("a") as any, 1);
    addReadLater(rPost("b") as any, 2);
    followSeries(
      {
        title: "Daily Thread",
        source: "reddit",
        community: { id: "c", handle: "r/c" },
      },
      1,
    );
    expect(
      estimatePackTotal(
        { readLater: true, series: true, feedSnapshot: true },
        50,
      ),
    ).toBe(2 + 1 + 100);
    expect(
      estimatePackTotal(
        { readLater: true, series: false, feedSnapshot: false },
        50,
      ),
    ).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// comment-sort resolution (cache-key parity with PostScreen)
// ---------------------------------------------------------------------------

describe("commentSortResolve", () => {
  const sorts = [{ id: "Hot" }, { id: "Top" }];

  it("matches the unified preference case-insensitively", () => {
    expect(defaultCommentSortFor(sorts, "top")).toBe("Top");
    expect(defaultCommentSortFor(sorts, "best")).toBe("Hot"); // fallback: first
    expect(defaultCommentSortFor([], "top")).toBe("");
  });

  it("uses the community's remembered sort when enabled and valid", async () => {
    (getCommunitySort as jest.Mock).mockResolvedValueOnce("Top");
    await expect(
      resolveCommentSort({
        sorts,
        preferred: "hot",
        communityId: "c",
        rememberCommunitySort: true,
      }),
    ).resolves.toBe("Top");
  });

  it("ignores memory when disabled or when the saved sort is invalid", async () => {
    await expect(
      resolveCommentSort({
        sorts,
        preferred: "top",
        communityId: "c",
        rememberCommunitySort: false,
      }),
    ).resolves.toBe("Top");
    (getCommunitySort as jest.Mock).mockResolvedValueOnce("confidence");
    await expect(
      resolveCommentSort({
        sorts,
        preferred: "hot",
        communityId: "c",
        rememberCommunitySort: true,
      }),
    ).resolves.toBe("Hot");
  });
});

describe("runPack + AI Lens scan", () => {
  const richComments = [
    { id: "c-root-hot", score: 9, body: { text: "top root comment" } },
    { id: "c-root-cold", score: 1, body: { text: "quiet root comment" } },
    {
      id: "c-reply",
      parentId: "c-root-hot",
      score: 99,
      body: { text: "hot reply" },
    },
  ];

  it("judges the post body and top root comments (replies excluded), best-effort", async () => {
    const target = rPost("abc", { body: { text: "the post body" } } as any);
    const reddit = fakeAdapter("reddit", {
      getPost: jest.fn(async () => target),
      getComments: jest.fn(async () => ({
        items: richComments,
        nextCursor: undefined,
      })),
    });
    const judgeText = jest.fn(async (text: string) => {
      if (text === "quiet root comment") throw new Error("engine hiccup");
      return { kind: "verdict" };
    });
    const deps = instantDeps(reddit, fakeAdapter("lemmy"), { judgeText });
    addReadLater(target as any, 1);

    const summary = await runPack(
      { readLater: true, series: false, feedSnapshot: false, aiScan: true },
      deps,
    );

    expect(judgeText.mock.calls.map((c) => c[0])).toEqual([
      "the post body",
      "top root comment", // roots by score desc…
      "quiet root comment", // …its failure swallowed
    ]);
    expect(summary.packed).toBe(1); // a judging failure never dents the pack
  });

  it("respects aiRootsCap and does nothing when aiScan is off", async () => {
    const target = rPost("abc", { body: { text: "the post body" } } as any);
    const reddit = fakeAdapter("reddit", {
      getPost: jest.fn(async () => target),
      getComments: jest.fn(async () => ({
        items: richComments,
        nextCursor: undefined,
      })),
    });
    const judgeText = jest.fn(async (_text: string) => ({}));
    addReadLater(target as any, 1);

    await runPack(
      { readLater: true, series: false, feedSnapshot: false, aiScan: true },
      instantDeps(reddit, fakeAdapter("lemmy"), { judgeText, aiRootsCap: 1 }),
    );
    expect(judgeText.mock.calls.map((c) => c[0])).toEqual([
      "the post body",
      "top root comment",
    ]);

    judgeText.mockClear();
    await runPack(
      { readLater: true, series: false, feedSnapshot: false },
      instantDeps(reddit, fakeAdapter("lemmy"), { judgeText }),
    );
    expect(judgeText).not.toHaveBeenCalled();
  });
});
