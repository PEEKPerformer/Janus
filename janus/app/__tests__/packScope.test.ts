import type { Post } from "../../core/model";
import { runPack, estimatePackTotal } from "../packer";
import {
  packedFeedPage,
  getPackedPost,
  listPackedItems,
  clearPack,
  beginPack,
  upsertPackedItem,
  savePackedPost,
} from "../offlinePack";
import {
  getPackPrefs,
  setPackPrefs,
  togglePackCommunity,
  DEFAULT_PACK_PREFS,
} from "../packPrefs";
import { addReadLater, __resetReadLater } from "../readLater";

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
    media: [{ kind: "image", url: "https://img/x", isNSFW: false }],
    ...over,
  }) as unknown as Post;

function fakeAdapter(source: "reddit" | "lemmy", over: any = {}) {
  return {
    source,
    instance: source === "reddit" ? "www.reddit.com" : "lemmy.world",
    capabilities: {
      sorts: { feed: [{ id: "hot" }], comment: [{ id: "top" }] },
    },
    getPost: jest.fn(async () => rPost("x")),
    getComments: jest.fn(async () => ({ items: [], nextCursor: undefined })),
    getFeed: jest.fn(async () => ({ items: [], nextCursor: undefined })),
    search: jest.fn(async () => ({ items: [], nextCursor: undefined })),
    ...over,
  } as any;
}

const deps = (reddit: any, lemmy: any, over: any = {}) => ({
  reddit,
  lemmy,
  adapterForEntity: jest.fn((e: { source: string }) =>
    e.source === "reddit" ? reddit : lemmy,
  ),
  resolveSort: jest.fn(async () => "top"),
  prefetchImage: jest.fn(async () => true),
  sleep: async () => {},
  now: () => 1_000,
  ...over,
});

afterEach(() => {
  __resetReadLater();
  clearPack();
  jest.clearAllMocks();
});

describe("packPrefs (extent & contexts persistence)", () => {
  it("defaults, patches and round-trips", () => {
    expect(getPackPrefs()).toEqual(DEFAULT_PACK_PREFS);
    setPackPrefs({ feedLimit: 100, includeImages: false });
    expect(getPackPrefs().feedLimit).toBe(100);
    expect(getPackPrefs().includeImages).toBe(false);
    expect(getPackPrefs().readLater).toBe(true); // untouched keys keep defaults
  });

  it("togglePackCommunity adds then removes", () => {
    const c = {
      id: "reddit:www.reddit.com:community:churning",
      handle: "r/churning",
      source: "reddit",
    };
    togglePackCommunity(c);
    expect(getPackPrefs().communities).toHaveLength(1);
    togglePackCommunity(c);
    expect(getPackPrefs().communities).toHaveLength(0);
  });
});

describe("packer: community scope and image extent", () => {
  const community = {
    id: "reddit:www.reddit.com:community:churning",
    handle: "r/churning",
  };

  it("packs chosen communities through their own adapter, honouring the limit", async () => {
    const reddit = fakeAdapter("reddit", {
      getFeed: jest.fn(async () => ({
        items: [rPost("c1"), rPost("c2")],
        nextCursor: undefined,
      })),
    });
    const d = deps(reddit, fakeAdapter("lemmy"));
    const summary = await runPack(
      {
        readLater: false,
        series: false,
        feedSnapshot: false,
        communities: [community],
        communityLimit: 10,
      },
      d,
    );
    expect(summary.total).toBe(2);
    expect(reddit.getFeed).toHaveBeenCalledWith(
      { communityId: community.id, sort: "hot" },
      { limit: 10 },
    );
    expect(listPackedItems().every((i) => i.origin === "community")).toBe(true);
  });

  it("includeImages: false skips every prefetch (text-only pack)", async () => {
    const reddit = fakeAdapter("reddit", {
      getFeed: jest.fn(async () => ({
        items: [rPost("a")],
        nextCursor: undefined,
      })),
    });
    const d = deps(reddit, fakeAdapter("lemmy"));
    await runPack(
      {
        readLater: false,
        series: false,
        feedSnapshot: false,
        communities: [community],
        includeImages: false,
      },
      d,
    );
    expect(d.prefetchImage).not.toHaveBeenCalled();
  });

  it("estimate counts community posts", () => {
    addReadLater(rPost("rl") as any, 1);
    expect(
      estimatePackTotal(
        {
          readLater: true,
          series: false,
          feedSnapshot: false,
          communities: [community],
          communityLimit: 10,
        },
        50,
      ),
    ).toBe(1 + 10);
  });
});

describe("packedFeedPage (first-class offline feed)", () => {
  const seed = (n: number) => {
    beginPack(1);
    for (let i = 0; i < n; i++) {
      const p = rPost(`p${i}`);
      savePackedPost(p);
      upsertPackedItem({
        id: p.id,
        title: p.title,
        community: p.community.handle,
        source: "reddit",
        commentCount: 1,
        origin: "feed",
        status: "packed",
      });
    }
  };

  it("pages through the pack with an offset cursor", () => {
    seed(7);
    const first = packedFeedPage({ limit: 3 });
    expect(first.items.map((p) => p.id)).toEqual([
      "reddit:www.reddit.com:post:p0",
      "reddit:www.reddit.com:post:p1",
      "reddit:www.reddit.com:post:p2",
    ]);
    expect(first.nextCursor).toBe(3);
    const second = packedFeedPage({ cursor: first.nextCursor, limit: 3 });
    expect(second.items).toHaveLength(3);
    const last = packedFeedPage({ cursor: second.nextCursor, limit: 3 });
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeUndefined();
  });

  it("skips failed rows and filters by community when pinned", () => {
    seed(2);
    upsertPackedItem({
      id: "reddit:www.reddit.com:post:p0",
      title: "t",
      community: "r/churning",
      source: "reddit",
      commentCount: 1,
      origin: "feed",
      status: "failed",
    });
    expect(packedFeedPage({ limit: 25 }).items.map((p) => p.id)).toEqual([
      "reddit:www.reddit.com:post:p1",
    ]);
    expect(
      packedFeedPage({ limit: 25 }, "reddit:www.reddit.com:community:other")
        .items,
    ).toEqual([]);
  });

  it("getPackedPost round-trips what the feed will open", () => {
    seed(1);
    expect(getPackedPost("reddit:www.reddit.com:post:p0")?.title).toBe(
      "Post p0",
    );
  });
});
