import { createAiPrefetcher, type PrefetchDeps } from "../aiPrefetch";
import { COMMENTS_CACHE, commentsCacheKey } from "../../app/contentCaches";
import type { AiQueue, AiPriority } from "../../app/aiLensQueue";
import type { Post } from "../../core/model";

const LONG = "x".repeat(400);

const post = (nativeId: string, over: Partial<Post> = {}): Post =>
  ({
    id: `reddit:www.reddit.com:post:${nativeId}`,
    source: "reddit",
    instance: "www.reddit.com",
    title: `Post ${nativeId}`,
    community: {
      id: "reddit:www.reddit.com:community:churning",
      handle: "r/churning",
    },
    commentCount: 0,
    body: {},
    media: [],
    createdAt: 1,
    ...over,
  }) as unknown as Post;

function makeDeps(over: Partial<PrefetchDeps> = {}) {
  const ran: { text: string; priority: AiPriority }[] = [];
  const queue: AiQueue = {
    run: async (text, priority) => {
      ran.push({ text, priority });
      return { kind: "too-short", tokens: 1 };
    },
    size: () => 0,
    shedPrefetch: () => {},
    subscribe: () => () => {},
  };
  const getComments = jest.fn(async () => ({
    items: [
      { id: "c1", score: 5, body: { text: `root one ${LONG}` } },
      { id: "c2", score: 9, body: { text: `root two ${LONG}` } },
      { id: "c3", parentId: "c1", score: 99, body: { text: `reply ${LONG}` } },
    ],
    nextCursor: undefined,
  }));
  const deps: PrefetchDeps = {
    adapterForEntity: jest.fn(() => ({ getComments }) as never),
    resolveSort: jest.fn(async () => "top"),
    queue,
    now: () => 1_000,
    ...over,
  };
  return { deps, ran, getComments };
}

describe("createAiPrefetcher", () => {
  it("queues long post bodies at prefetch priority, once per post", async () => {
    const { deps, ran } = makeDeps();
    const prefetch = createAiPrefetcher(deps);
    const page = [
      post("a", { body: { text: LONG } } as Partial<Post>),
      post("b", { body: { text: "short" } } as Partial<Post>), // skipped: short
      post("c"), // skipped: no body
    ];
    await prefetch(page);
    await prefetch(page); // second page render — no double work
    expect(ran).toEqual([{ text: LONG, priority: 2 }]);
  });

  it("fetches comments for the busiest threads, caches them, judges top roots", async () => {
    const { deps, ran, getComments } = makeDeps({ threadCap: 1, rootsCap: 1 });
    const prefetch = createAiPrefetcher(deps);
    const busy = post("busy", { commentCount: 50 } as Partial<Post>);
    await prefetch([busy, post("quiet", { commentCount: 2 } as Partial<Post>)]);
    expect(getComments).toHaveBeenCalledTimes(1);
    // Highest-scored ROOT (not the hot reply), capped at 1.
    expect(ran.map((r) => r.text)).toEqual([`root two ${LONG}`]);
    // And the comments page now warms the exact key PostScreen reads.
    expect(
      COMMENTS_CACHE.read(
        commentsCacheKey("reddit", busy.id, "top"),
        1_000,
        60_000,
      ),
    ).toBeTruthy();
  });

  it("reuses a fresh comments cache instead of refetching", async () => {
    const { deps, getComments } = makeDeps({ threadCap: 1 });
    const busy = post("warm", { commentCount: 50 } as Partial<Post>);
    COMMENTS_CACHE.write(
      commentsCacheKey("reddit", busy.id, "top"),
      { items: [{ id: "c9", score: 1, body: { text: LONG } }] },
      1_000,
    );
    await createAiPrefetcher(deps)([busy]);
    expect(getComments).not.toHaveBeenCalled();
  });

  it("skips the network tier entirely when offline", async () => {
    const { deps, getComments } = makeDeps({ isOffline: () => true });
    await createAiPrefetcher(deps)([
      post("busy", { commentCount: 50 } as Partial<Post>),
    ]);
    expect(getComments).not.toHaveBeenCalled();
  });
});
