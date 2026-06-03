/**
 * Maps a Reddit `t2` (account) Thing into the unified User model — used by the
 * profile screen. Pure + testable.
 */
import type { User } from "../../../core/model";
import {
  rid,
  rkey,
  richText,
  REDDIT_SOURCE,
  REDDIT_INSTANCE,
} from "./shared";

export function mapRedditUser(child: any): User {
  const d = child?.data ?? child ?? {};
  const name: string = d.name ?? "";
  const icon =
    typeof d.icon_img === "string" ? d.icon_img.split("?")[0] : undefined;
  const snoovatar =
    typeof d.snoovatar_img === "string" && d.snoovatar_img
      ? d.snoovatar_img.split("?")[0]
      : undefined;
  return {
    id: rid("user", name),
    dedupKey: rkey(d.name ? `t2_${d.id ?? name}` : name),
    source: REDDIT_SOURCE,
    instance: REDDIT_INSTANCE,
    username: name,
    handle: `u/${name}`,
    displayName: d.subreddit?.title || undefined,
    avatar: snoovatar || icon,
    banner:
      typeof d.subreddit?.banner_img === "string"
        ? d.subreddit.banner_img.split("?")[0] || undefined
        : undefined,
    bio: richText(d.subreddit?.public_description),
    createdAt: typeof d.created_utc === "number" ? d.created_utc * 1000 : 0,
    isBot: false,
    isAdmin: !!d.is_employee,
    postScore: d.link_karma ?? undefined,
    commentScore: d.comment_karma ?? undefined,
    ext: { source: "reddit" },
  };
}
