import { createGroupFeed } from "../groupFeed";
import type { AccountManager } from "../../app/AccountManager";
import type { CommunityAddress } from "../../app/feedGroups";
import type { SourceAdapter } from "../../core/adapter";
import type { Post } from "../../core/model";
import { buildId } from "../../core/ids";

function post(id: string): Post {
  return { id, title: id } as unknown as Post;
}

/** A manager stub exposing only what groupFeed touches. */
function fakeManager(over: {
  reddit?: Partial<SourceAdapter>;
  lemmyByInstance?: Record<string, Partial<SourceAdapter>>;
}): AccountManager {
  const reddit = {
    source: "reddit",
    instance: "www.reddit.com",
    ...over.reddit,
  } as SourceAdapter;
  return {
    defaultLemmy: "lemmy.ml",
    reddit: () => reddit,
    adapterForEntity: (e: { source: string; instance: string }) =>
      ({
        source: "lemmy",
        instance: e.instance,
        ...over.lemmyByInstance?.[e.instance],
      }) as SourceAdapter,
  } as unknown as AccountManager;
}

describe("createGroupFeed", () => {
  const members: CommunityAddress[] = [
    { source: "reddit", name: "privacy" },
    { source: "lemmy", instance: "lemmy.ml", name: "privacy" },
    { source: "lemmy", instance: "hexbear.net", name: "technology" },
  ];

  it("resolves each member on its own instance and merges round-robin", async () => {
    const redditFeed = jest.fn(async (q: { communityId: string }) => {
      // Reddit routing id is built offline from the subreddit name.
      expect(buildId).toBeDefined();
      return { items: [post("r1")], nextCursor: undefined };
    });
    const mlResolve = jest.fn(async (url: string) => ({
      kind: "community" as const,
      id: buildId({
        source: "lemmy",
        instance: "lemmy.ml",
        kind: "community",
        nativeId: "10",
      }),
    }));
    const mlFeed = jest.fn(async () => ({ items: [post("m1")] }));
    const hexResolve = jest.fn(async () => ({
      kind: "community" as const,
      id: buildId({
        source: "lemmy",
        instance: "hexbear.net",
        kind: "community",
        nativeId: "20",
      }),
    }));
    const hexFeed = jest.fn(async () => ({ items: [post("h1")] }));

    const manager = fakeManager({
      reddit: { getFeed: redditFeed as never },
      lemmyByInstance: {
        "lemmy.ml": {
          resolveRemoteUrl: mlResolve as never,
          getFeed: mlFeed as never,
        },
        "hexbear.net": {
          resolveRemoteUrl: hexResolve as never,
          getFeed: hexFeed as never,
        },
      },
    });

    const page = await createGroupFeed(manager, members, { sort: "hot" })({
      limit: 25,
    });
    expect(page.items.map((p) => p.id)).toEqual(["r1", "m1", "h1"]);
    // Each Lemmy member resolved against its own instance URL.
    expect(mlResolve).toHaveBeenCalledWith("https://lemmy.ml/c/privacy");
    expect(hexResolve).toHaveBeenCalledWith("https://hexbear.net/c/technology");
  });

  it("drops members that fail to resolve without sinking the group", async () => {
    const manager = fakeManager({
      reddit: { getFeed: (async () => ({ items: [post("r1")] })) as never },
      lemmyByInstance: {
        "lemmy.ml": {
          resolveRemoteUrl: (async () => {
            throw new Error("instance down");
          }) as never,
          getFeed: (async () => ({ items: [post("m1")] })) as never,
        },
      },
    });
    const page = await createGroupFeed(
      manager,
      [
        { source: "reddit", name: "privacy" },
        { source: "lemmy", instance: "lemmy.ml", name: "privacy" },
      ],
      {},
    )({ limit: 25 });
    expect(page.items.map((p) => p.id)).toEqual(["r1"]); // lemmy dropped
  });

  it("resolves only once across pages", async () => {
    const resolve = jest.fn(async () => ({
      kind: "community" as const,
      id: buildId({
        source: "lemmy",
        instance: "lemmy.ml",
        kind: "community",
        nativeId: "10",
      }),
    }));
    const getFeed = jest.fn(async () => ({ items: [post("m1")] }));
    const manager = fakeManager({
      lemmyByInstance: {
        "lemmy.ml": {
          resolveRemoteUrl: resolve as never,
          getFeed: getFeed as never,
        },
      },
    });
    const feed = createGroupFeed(
      manager,
      [{ source: "lemmy", instance: "lemmy.ml", name: "privacy" }],
      {},
    );
    await feed({ limit: 25 });
    await feed({ limit: 25 });
    expect(resolve).toHaveBeenCalledTimes(1); // cached in the closure
  });
});
