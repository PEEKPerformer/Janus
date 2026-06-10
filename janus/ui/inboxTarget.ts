import type { Notification } from "../core/model";
import { buildId, type JanusId } from "../core/ids";

/**
 * Resolve where a notification should take you: the post — and, when the
 * notification is ABOUT a comment, that exact comment, so the thread opens
 * scrolled to it instead of dumping you at the root.
 *
 *  - Reddit: the context permalink is `/r/sub/comments/POST/title/COMMENT/…`;
 *    both ids are in the path (comment ids become `t1_` fullnames, matching
 *    the comment mapper).
 *  - Lemmy: the adapter stores `id` (post) and `commentId` route params.
 */
export interface NotificationTarget {
  postId: JanusId;
  commentId?: JanusId;
}

export function notificationTarget(n: Notification): NotificationTarget | null {
  const r = n.contextRoute;
  if (!r) return null;
  if (n.source === "reddit") {
    const m = /comments\/([a-z0-9]+)(?:\/[^/]*\/([a-z0-9]+))?/i.exec(
      r.params.permalink ?? "",
    );
    if (!m) return null;
    return {
      postId: buildId({
        source: "reddit",
        instance: n.instance,
        kind: "post",
        nativeId: m[1],
      }),
      commentId: m[2]
        ? buildId({
            source: "reddit",
            instance: n.instance,
            kind: "comment",
            nativeId: `t1_${m[2]}`,
          })
        : undefined,
    };
  }
  const id = r.params.id;
  if (!id) return null;
  return {
    postId: buildId({
      source: "lemmy",
      instance: n.instance,
      kind: "post",
      nativeId: id,
    }),
    commentId: r.params.commentId
      ? buildId({
          source: "lemmy",
          instance: n.instance,
          kind: "comment",
          nativeId: r.params.commentId,
        })
      : undefined,
  };
}
