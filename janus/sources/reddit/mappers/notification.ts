/**
 * Maps a Reddit inbox Thing (t1 comment reply / mention, or t4 private message)
 * into the unified Notification model. Pure + testable.
 */
import type { Notification, NotificationKind } from "../../../core/model";
import { rid, rkey, richText, REDDIT_SOURCE, REDDIT_INSTANCE } from "./shared";

function inboxKind(child: any): NotificationKind {
  if (child.kind === "t4") return "privateMessage";
  const subject = String(child.data?.subject ?? "").toLowerCase();
  if (subject.includes("mention")) return "mention";
  return "commentReply";
}

export function mapRedditNotification(child: any): Notification {
  const d = child?.data ?? {};
  const author: string = d.author ?? "";
  return {
    id: rid("message", d.name ?? ""),
    dedupKey: rkey(d.name ?? ""),
    source: REDDIT_SOURCE,
    instance: REDDIT_INSTANCE,
    kind: inboxKind(child),
    read: !d.new, // Reddit's `new` is true when UNREAD
    createdAt: (d.created_utc ?? 0) * 1000,
    author: author
      ? { id: rid("user", author), username: author, handle: `u/${author}` }
      : undefined,
    subject: d.subject || d.link_title || undefined,
    body: richText(d.body, d.body_html),
    contextRoute: d.context
      ? {
          source: REDDIT_SOURCE,
          instance: REDDIT_INSTANCE,
          kind: "post",
          params: { permalink: d.context },
        }
      : undefined,
    ext: { source: "reddit" },
  };
}
