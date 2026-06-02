/**
 * The single, source-agnostic comment-tree machinery. Both adapters return a
 * FLAT Comment[] (each with `parentId` + `depth`); `buildCommentTree` re-nests
 * them, and `flattenVisible` turns the tree (plus a collapsed-set) back into a
 * flat, depth-tagged list so the UI can render each comment as its OWN
 * virtualized FlashList row instead of mounting whole subtrees at once.
 */

import type { Comment } from "./model";
import type { JanusId } from "./ids";

export interface CommentNode {
  comment: Comment;
  replies: CommentNode[];
}

/**
 * Build a forest from a flat list, preserving input order at every level.
 * Hardened against malformed federated data: a comment that is its own parent,
 * or whose parent chain would form a cycle, degrades to a root rather than
 * vanishing (zero roots) or causing infinite recursion downstream.
 */
export function buildCommentTree(flat: Comment[]): CommentNode[] {
  const nodes = new Map<JanusId, CommentNode>();
  for (const comment of flat) nodes.set(comment.id, { comment, replies: [] });

  const wouldCycle = (childId: JanusId, parentId: JanusId): boolean => {
    let cursor: JanusId | undefined = parentId;
    let hops = 0;
    while (cursor && hops < 10_000) {
      if (cursor === childId) return true;
      cursor = nodes.get(cursor)?.comment.parentId;
      hops++;
    }
    return false;
  };

  const roots: CommentNode[] = [];
  for (const comment of flat) {
    const node = nodes.get(comment.id)!;
    const pid = comment.parentId;
    const parent = pid && pid !== comment.id ? nodes.get(pid) : undefined;
    if (parent && !wouldCycle(comment.id, pid!)) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Total comment count in a forest. */
export function countComments(forest: CommentNode[]): number {
  let n = 0;
  for (const node of forest) n += 1 + countComments(node.replies);
  return n;
}

export interface VisibleComment {
  comment: Comment;
  depth: number;
  /** Total descendants in the full subtree (for the collapsed "+N" badge). */
  descendantCount: number;
  hasChildren: boolean;
  collapsed: boolean;
}

/**
 * Depth-first flatten of the visible comments given a set of collapsed ids.
 * Subtree sizes are memoized in a single O(n) pass so toggling collapse is cheap
 * even on large threads.
 */
export function flattenVisible(forest: CommentNode[], collapsed: Set<JanusId>): VisibleComment[] {
  const sizes = new Map<JanusId, number>();
  const measure = (node: CommentNode): number => {
    let n = 0;
    for (const child of node.replies) n += 1 + measure(child);
    sizes.set(node.comment.id, n);
    return n;
  };
  forest.forEach(measure);

  const out: VisibleComment[] = [];
  const walk = (node: CommentNode, depth: number) => {
    const isCollapsed = collapsed.has(node.comment.id);
    out.push({
      comment: node.comment,
      depth,
      descendantCount: sizes.get(node.comment.id) ?? 0,
      hasChildren: node.replies.length > 0,
      collapsed: isCollapsed,
    });
    if (!isCollapsed) for (const child of node.replies) walk(child, depth + 1);
  };
  forest.forEach((root) => walk(root, 0));
  return out;
}
