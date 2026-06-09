import type { VisibleComment } from "../core/comment-tree";

/**
 * Find-in-thread: case-insensitive substring match over the rendered comment
 * rows (body + author handle). Returns indices into `visible`, in order, so
 * the screen can scrollToIndex through them. Load-more rows never match;
 * collapsed parents still do (their row is on screen to jump to).
 */
export function findThreadMatches(
  visible: VisibleComment[],
  query: string,
): number[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: number[] = [];
  for (let i = 0; i < visible.length; i++) {
    const v = visible[i];
    if (v.loadMore) continue;
    const body = v.comment.body.text?.toLowerCase() ?? "";
    const author = v.comment.author.handle.toLowerCase();
    if (body.includes(q) || author.includes(q)) out.push(i);
  }
  return out;
}

/**
 * New-comment marking: a comment is NEW when it landed after your previous
 * visit and isn't your own fresh reply (you know you wrote that).
 */
export function isNewComment(
  comment: { createdAt: number; author: { username: string } },
  previousVisit: number | null,
  me: string | null,
): boolean {
  if (previousVisit == null) return false;
  if (comment.createdAt <= previousVisit) return false;
  return !me || comment.author.username !== me;
}
