import {
  mapLemmyPost,
  mapLemmyComment,
  mapLemmyCommunity,
  parsePath,
  handle,
  hostOf,
  lemmyTime,
  subscribedState,
  lid,
} from "../mappers";
import { lemmyListFixture, lemmyCommentsFixture } from "../__fixtures__/lemmySamples";
import { Vote } from "../../../core/vote";

const INSTANCE = "lemmy.world";
const [localPost, remotePost] = lemmyListFixture.posts;

describe("lemmy helpers", () => {
  it("hostOf extracts the actor host", () => {
    expect(hostOf("https://beehaw.org/c/news")).toBe("beehaw.org");
    expect(hostOf("garbage")).toBe("");
  });

  it("handle is bare when local, instance-qualified when remote", () => {
    expect(handle("news", true, "https://lemmy.world/c/news")).toBe("news");
    expect(handle("news", false, "https://beehaw.org/c/news")).toBe("news@beehaw.org");
  });

  it("lemmyTime treats a Z-less timestamp as UTC", () => {
    expect(lemmyTime("2024-05-01T12:00:00")).toBe(Date.parse("2024-05-01T12:00:00Z"));
    expect(lemmyTime(null)).toBe(0);
  });

  it("subscribedState maps the tri-state", () => {
    expect(subscribedState("Subscribed")).toBe("subscribed");
    expect(subscribedState("Pending")).toBe("pending");
    expect(subscribedState("NotSubscribed")).toBe("none");
  });

  it("parsePath derives depth + parent from the dotted path", () => {
    expect(parsePath("0.10")).toEqual({ depth: 0, parentNativeId: undefined });
    expect(parsePath("0.10.11")).toEqual({ depth: 1, parentNativeId: "10" });
    expect(parsePath("0.10.11.12")).toEqual({ depth: 2, parentNativeId: "11" });
  });
});

describe("mapLemmyPost", () => {
  it("maps a local image post with federation-stable dedupKey", () => {
    const post = mapLemmyPost(localPost, INSTANCE);
    expect(post.id).toBe("lemmy:lemmy.world:post:1001");
    expect(post.dedupKey).toBe("https://lemmy.world/post/1001"); // ap_id
    expect(post.title).toBe("A local image post");
    expect(post.community.handle).toBe("technology"); // local
    expect(post.author.handle).toBe("alice"); // local
    expect(post.score).toBe(321);
    expect(post.userVote).toBe(Vote.Up);
    expect(post.commentCount).toBe(12);
    expect(post.isStickied).toBe(true); // featured_community
    expect(post.media[0]).toMatchObject({ kind: "image", url: localPost.post.url, width: 1000, height: 500 });
    expect(post.createdAt).toBe(Date.parse("2024-05-01T12:00:00Z"));
  });

  it("maps a remote link post with instance-qualified handles", () => {
    const post = mapLemmyPost(remotePost, INSTANCE);
    expect(post.community.handle).toBe("news@beehaw.org"); // remote community
    expect(post.author.handle).toBe("bob@sh.itjust.works"); // remote author
    expect(post.dedupKey).toBe("https://beehaw.org/post/55");
    expect(post.interactionStatus).toBe("locked");
    expect(post.saved).toBe(true);
    expect(post.media[0]).toMatchObject({ kind: "link", url: "https://example.com/story" });
    expect(post.externalLink).toBe("https://example.com/story");
  });
});

describe("mapLemmyComment", () => {
  const postId = lid(INSTANCE, "post", 1001);
  const [c10, c11, c12] = lemmyCommentsFixture.comments.map((cv: unknown) =>
    mapLemmyComment(cv, postId, INSTANCE),
  );

  it("derives parentId/depth from path and flags OP", () => {
    expect(c10.depth).toBe(0);
    expect(c10.parentId).toBeUndefined();
    expect(c10.isOP).toBe(true); // creator_id 7 === post.creator_id 7
    expect(c11.depth).toBe(1);
    expect(c11.parentId).toBe(c10.id);
    expect(c11.isOP).toBe(false);
  });

  it("instance-qualifies a remote commenter's handle", () => {
    expect(c12.author.handle).toBe("dave@beehaw.org");
    expect(c12.dedupKey).toBe("https://beehaw.org/comment/12");
  });
});

describe("mapLemmyCommunity", () => {
  it("maps a community view", () => {
    const c = mapLemmyCommunity(localPost, INSTANCE); // localPost has .community
    // mapLemmyCommunity expects { community, counts, subscribed } or a bare community
    const community = mapLemmyCommunity({ community: localPost.community, counts: { subscribers: 999 }, subscribed: "Subscribed" }, INSTANCE);
    expect(community.name).toBe("technology");
    expect(community.subscriberCount).toBe(999);
    expect(community.subscription).toBe("subscribed");
    expect(c.source).toBe("lemmy");
  });
});
