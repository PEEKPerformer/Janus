/**
 * The single, source-agnostic comment-tree builder. Both adapters return a FLAT
 * Comment[] (each with `parentId` + `depth`); this re-nests them into a tree.
 * Reddit's adapter flattens its native nested structure; Lemmy's derives
 * parentId/depth from the dotted `path`. One algorithm serves both.
 */

import type { Comment } from "./model";
import type { JanusId } from "./ids";

export interface CommentNode {
  comment: Comment;
  replies: CommentNode[];
}

/**
 * Build a forest of comment nodes from a flat list, preserving the input order
 * at every level. A comment whose parentId is absent from the list (e.g. a
 * top-level comment, or an orphan from incremental load-more) becomes a root.
 */
export function buildCommentTree(flat: Comment[]): CommentNode[] {
  const nodes = new Map<JanusId, CommentNode>();
  for (const comment of flat) {
    nodes.set(comment.id, { comment, replies: [] });
  }

  const roots: CommentNode[] = [];
  for (const comment of flat) {
    const node = nodes.get(comment.id)!;
    const parent = comment.parentId ? nodes.get(comment.parentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Total comment count in a forest (handy for tests and headers). */
export function countComments(forest: CommentNode[]): number {
  let n = 0;
  for (const node of forest) n += 1 + countComments(node.replies);
  return n;
}
