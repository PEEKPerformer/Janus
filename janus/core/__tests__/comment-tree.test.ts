import { buildCommentTree, countComments, type CommentNode } from "../comment-tree";
import type { Comment } from "../model";
import { buildId, dedupKey, type JanusId } from "../ids";
import { Vote } from "../vote";

// Minimal Comment factory for tree-shape testing (only fields the builder reads).
function cmt(nativeId: string, parent?: JanusId): Comment {
  const id = buildId({ source: "reddit", instance: "www.reddit.com", kind: "comment", nativeId });
  return {
    id,
    dedupKey: dedupKey(nativeId),
    source: "reddit",
    instance: "www.reddit.com",
    postId: buildId({ source: "reddit", instance: "www.reddit.com", kind: "post", nativeId: "t3_p" }),
    parentId: parent,
    author: { id: buildId({ source: "reddit", instance: "www.reddit.com", kind: "user", nativeId: "u" }), username: "u", handle: "u/u" },
    body: {},
    createdAt: 0,
    score: 0,
    scoreHidden: false,
    userVote: Vote.None,
    saved: false,
    isOP: false,
    isStickied: false,
    distinguished: null,
    depth: 0,
    childCount: 0,
    permalinkRoute: { source: "reddit", instance: "www.reddit.com", kind: "post", params: {} },
    ext: { source: "reddit", distinguished: null },
  };
}

const ids = (nodes: CommentNode[]): string[] => nodes.map((n) => n.comment.dedupKey);

describe("buildCommentTree", () => {
  it("nests children under parents and preserves order", () => {
    const a = cmt("a");
    const b = cmt("b", a.id);
    const c = cmt("c", a.id);
    const d = cmt("d", b.id);
    const e = cmt("e"); // second root

    const forest = buildCommentTree([a, b, c, d, e]);
    expect(ids(forest)).toEqual(["a", "e"]);
    const aNode = forest[0];
    expect(ids(aNode.replies)).toEqual(["b", "c"]); // order preserved
    expect(ids(aNode.replies[0].replies)).toEqual(["d"]);
    expect(countComments(forest)).toBe(5);
  });

  it("treats a comment with an unknown parent as a root (orphan tolerance)", () => {
    const a = cmt("a");
    const orphan = cmt("z", buildId({ source: "reddit", instance: "www.reddit.com", kind: "comment", nativeId: "missing" }));
    const forest = buildCommentTree([a, orphan]);
    expect(ids(forest)).toEqual(["a", "z"]);
  });

  it("handles an empty list", () => {
    expect(buildCommentTree([])).toEqual([]);
    expect(countComments([])).toBe(0);
  });
});
