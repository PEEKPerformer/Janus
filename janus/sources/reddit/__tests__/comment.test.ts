import { flattenRedditComments } from "../mappers/comment";
import { postCommentsFixture } from "../__fixtures__/redditSamples";
import { Vote } from "../../../core/vote";
import { rid } from "../mappers/shared";

const postId = rid("post", "t3_abc100");
const rootChildren = postCommentsFixture[1].data.children;

describe("flattenRedditComments", () => {
  const { comments, topLevelMore } = flattenRedditComments(rootChildren, postId);

  it("flattens nested comments depth-first with parentId + depth set", () => {
    // topComment (c100) -> nestedReply (c200); secondTopComment (c150)
    expect(comments.map((c) => c.dedupKey)).toEqual(["t1_c100", "t1_c200", "t1_c150"]);

    const [top, nested, second] = comments;
    expect(top.depth).toBe(0);
    expect(top.parentId).toBeUndefined();
    expect(nested.depth).toBe(1);
    expect(nested.parentId).toBe(top.id);
    expect(second.depth).toBe(0);
    expect(second.parentId).toBeUndefined();
  });

  it("maps OP / moderator / vote / edited / scoreHidden fields", () => {
    const [top, , second] = comments;
    expect(top.isOP).toBe(true);
    expect(top.distinguished).toBe("moderator");
    expect(top.isStickied).toBe(true);
    expect(top.userVote).toBe(Vote.Up);
    expect(top.editedAt).toBe(1_700_000_250 * 1000);
    expect(top.body.html).toBe("<p>Top-level comment</p>");
    expect(second.scoreHidden).toBe(true);
  });

  it("captures a comment's `more` replies as a reddit LoadMoreRef", () => {
    const top = comments[0];
    expect(top.loadMore).toEqual({ kind: "reddit", childIds: ["c201", "c202"], depth: 1 });
    // childCount = 1 visible reply (c200) + 2 from the more node
    expect(top.childCount).toBe(3);
  });

  it("surfaces the top-level `more` node separately", () => {
    expect(topLevelMore).toEqual({ kind: "reddit", childIds: ["c900", "c901", "c902"], depth: 0 });
  });
});
