import { mapPost } from "../mappers/post";
import { listingFixture } from "../__fixtures__/redditSamples";
import { Vote } from "../../../core/vote";

const [selfChild, imageChild, linkChild] = listingFixture.data.children;

describe("mapPost", () => {
  it("maps a self/text post with decoded title + body and upvote state", () => {
    const post = mapPost(selfChild);
    expect(post.id).toBe("reddit:www.reddit.com:post:t3_abc100");
    expect(post.dedupKey).toBe("t3_abc100");
    expect(post.source).toBe("reddit");
    expect(post.title).toBe("A self post about & things"); // &amp; decoded
    expect(post.author).toMatchObject({ username: "alice", handle: "u/alice" });
    expect(post.community).toMatchObject({ name: "aww", handle: "r/aww" });
    expect(post.score).toBe(1234);
    expect(post.userVote).toBe(Vote.Up);
    expect(post.commentCount).toBe(42);
    expect(post.createdAt).toBe(1_700_000_000 * 1000);
    expect(post.body.markdown).toBe("Hello **world**");
    expect(post.body.html).toBe("<div>Hello <b>world</b></div>"); // entities decoded
    expect(post.media).toHaveLength(0);
    expect(post.interactionStatus).toBeNull();
  });

  it("extracts a preview image with source + resolution variants", () => {
    const post = mapPost(imageChild);
    expect(post.saved).toBe(true);
    expect(post.userVote).toBe(Vote.None);
    expect(post.media).toHaveLength(1);
    const img = post.media[0];
    expect(img.kind).toBe("image");
    expect(img.url).toBe("https://preview.redd.it/xyz.jpg?full");
    expect(img.width).toBe(1200);
    expect(img.height).toBe(800);
    expect(img.aspectRatio).toBeCloseTo(1.5);
    expect(img.variants).toHaveLength(2);
    expect(img.thumbnailUrl).toBe("https://preview.redd.it/xyz.jpg?w=320");
    expect(post.thumbnail).toBe(img);
  });

  it("maps a downvoted, locked, stickied external link post", () => {
    const post = mapPost(linkChild);
    expect(post.userVote).toBe(Vote.Down);
    expect(post.isStickied).toBe(true);
    expect(post.interactionStatus).toBe("locked");
    expect(post.externalLink).toBe("https://example.com/article");
    expect(post.media).toEqual([
      expect.objectContaining({ kind: "link", url: "https://example.com/article" }),
    ]);
    expect(post.community.handle).toBe("r/news");
  });
});
