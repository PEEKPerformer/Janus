import { LemmyAdapter, type FetchJson } from "../lemmy-adapter";
import { lemmyListFixture, lemmyPostFixture, lemmyCommentsFixture } from "../__fixtures__/lemmySamples";
import { lid } from "../mappers";
import { buildCommentTree, countComments } from "../../../core/comment-tree";
import { Vote } from "../../../core/vote";

function fixtureAdapter(jwt?: string) {
  const urls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    urls.push(url);
    if (url.includes("/post/list")) return lemmyListFixture;
    if (url.includes("/post?")) return lemmyPostFixture;
    if (url.includes("/comment/list")) return lemmyCommentsFixture;
    if (url.includes("/resolve_object")) return { community: { community: { id: 3 } } };
    throw new Error(`unexpected url ${url}`);
  };
  return { adapter: new LemmyAdapter({ instance: "lemmy.world", fetchJson, jwt }), urls };
}

describe("LemmyAdapter", () => {
  it("advertises Lemmy capabilities (federation yes, multireddits no)", () => {
    const { adapter } = fixtureAdapter();
    expect(adapter.source).toBe("lemmy");
    expect(adapter.capabilities.supportsFederationResolve).toBe(true);
    expect(adapter.capabilities.supportsMultireddits).toBe(false);
    expect(adapter.capabilities.topRequiresTimeWindow).toBe(true);
    expect(adapter.account.isGuest).toBe(true);
  });

  it("getFeed maps posts and threads the page cursor", async () => {
    const { adapter, urls } = fixtureAdapter();
    const page = await adapter.getFeed({ sort: "top", timeWindow: "week", listingType: "All" }, { limit: 25 });
    expect(urls[0]).toContain("/post/list");
    expect(urls[0]).toContain("sort=TopWeek"); // top + week -> TopWeek
    expect(urls[0]).toContain("type_=All");
    expect(page.items).toHaveLength(2);
    expect(page.items[0].title).toBe("A local image post");
    expect(page.nextCursor).toBe("PAGECURSOR2");
  });

  it("getComments returns a flat list that the CORE tree builder nests", async () => {
    const { adapter } = fixtureAdapter();
    const postId = lid("lemmy.world", "post", 1001);
    const page = await adapter.getComments(postId, {});
    expect(page.items).toHaveLength(3);

    // Same builder Reddit uses — proves the unified comment path.
    const forest = buildCommentTree(page.items);
    expect(forest).toHaveLength(2); // c10 (with child c11) + c12
    expect(forest[0].replies).toHaveLength(1);
    expect(forest[0].replies[0].comment.dedupKey).toBe("https://lemmy.world/comment/11");
    expect(countComments(forest)).toBe(3);
  });

  it("getPost maps the post_view", async () => {
    const { adapter, urls } = fixtureAdapter();
    const post = await adapter.getPost(lid("lemmy.world", "post", 1001));
    expect(urls[0]).toContain("/post?id=1001");
    expect(post.commentCount).toBe(12);
  });

  it("vote without a JWT throws a typed NotAuthenticatedError", async () => {
    const { adapter } = fixtureAdapter();
    await expect(adapter.vote(lid("lemmy.world", "post", 1001), Vote.Up)).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
  });

  it("resolveRemoteUrl works (Lemmy federation)", async () => {
    const { adapter } = fixtureAdapter();
    const resolved = await adapter.resolveRemoteUrl("https://beehaw.org/c/news");
    expect(resolved).toEqual({ kind: "community", id: lid("lemmy.world", "community", 3) });
  });
});
