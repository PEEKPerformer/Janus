/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Comment, LoadMoreRef } from "../../../core/model";
import type { JanusId } from "../../../core/ids";
import * as S from "./shared";

function distinguished(d: any): "moderator" | "admin" | null {
  if (d === "moderator") return "moderator";
  if (d === "admin") return "admin";
  return null;
}

interface MapExtra {
  parentId?: JanusId;
  depth: number;
  childCount: number;
  loadMore?: LoadMoreRef;
}

function mapComment(data: any, postId: JanusId, extra: MapExtra): Comment {
  return {
    id: S.rid("comment", data.name),
    dedupKey: S.rkey(data.name),
    source: "reddit",
    instance: S.REDDIT_INSTANCE,
    postId,
    parentId: extra.parentId,
    author: S.authorRef(data.author),
    body: S.richText(data.body, data.body_html),
    createdAt: (data.created ?? 0) * 1000,
    editedAt: data.edited ? data.edited * 1000 : undefined,
    score: data.ups ?? 0,
    scoreHidden: !!data.score_hidden,
    userVote: S.voteFromLikes(data.likes),
    saved: !!data.saved,
    isOP: !!data.is_submitter,
    isStickied: !!data.stickied,
    distinguished: distinguished(data.distinguished),
    depth: extra.depth,
    childCount: extra.childCount,
    loadMore: extra.loadMore,
    permalinkRoute: { source: "reddit", instance: S.REDDIT_INSTANCE, kind: "post", params: { permalink: data.permalink ?? "" } },
    ext: { source: "reddit", distinguished: distinguished(data.distinguished) },
  };
}

function repliesChildren(data: any): any[] {
  // Reddit replies is either "" (none) or a Listing object.
  if (data.replies && typeof data.replies === "object") {
    return data.replies.data?.children ?? [];
  }
  return [];
}

function moreToRef(moreData: any, depth: number): LoadMoreRef {
  return { kind: "reddit", childIds: moreData.children ?? [], depth: moreData.depth ?? depth };
}

/**
 * Flatten Reddit's nested comment listing into a FLAT Comment[] with parentId
 * and depth set, so the source-agnostic core CommentTree builder can re-nest it
 * the same way it nests Lemmy comments. Per-comment `loadMore` comes from a
 * `more` node inside that comment's replies; the top-level `more` (more root
 * comments) is returned separately for the adapter to surface as pagination.
 */
export function flattenRedditComments(
  rootChildren: any[],
  postId: JanusId,
): { comments: Comment[]; topLevelMore?: LoadMoreRef } {
  const out: Comment[] = [];

  const walk = (children: any[], parentId: JanusId | undefined, depth: number) => {
    for (const child of children) {
      if (child.kind !== "t1") continue;
      const data = child.data;
      const replies = repliesChildren(data);
      const moreNode = replies.find((c) => c.kind === "more");
      const t1Replies = replies.filter((c) => c.kind === "t1");
      const childCount =
        t1Replies.length + (moreNode ? (moreNode.data.count ?? moreNode.data.children?.length ?? 0) : 0);
      const comment = mapComment(data, postId, {
        parentId,
        depth,
        childCount,
        loadMore: moreNode ? moreToRef(moreNode.data, depth + 1) : undefined,
      });
      out.push(comment);
      walk(t1Replies, comment.id, depth + 1);
    }
  };

  const rootMore = rootChildren.find((c) => c.kind === "more");
  walk(rootChildren, undefined, 0);

  return {
    comments: out,
    topLevelMore: rootMore ? moreToRef(rootMore.data, 0) : undefined,
  };
}
