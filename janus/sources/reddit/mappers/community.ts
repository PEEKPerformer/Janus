/**
 * Maps a Reddit `t5` (subreddit) Thing into the unified Community model — used
 * by the community picker's subreddit search. Pure + testable.
 */
import { decode } from "html-entities";
import type { Community } from "../../../core/model";
import {
  rid,
  rkey,
  richText,
  communityRoute,
  subredditIcon,
  REDDIT_SOURCE,
  REDDIT_INSTANCE,
} from "./shared";

export function mapRedditCommunity(child: any): Community {
  const d = child?.data ?? child ?? {};
  const name: string = d.display_name ?? "";
  const rawIcon =
    subredditIcon(d) ||
    (typeof d.icon_img === "string" ? d.icon_img : undefined);
  const icon = rawIcon ? rawIcon.split("?")[0] : undefined; // drop Reddit's signing query
  return {
    id: rid("community", name),
    dedupKey: rkey(d.name ?? `t5_${name}`), // fullname (t5_…) is the stable key
    source: REDDIT_SOURCE,
    instance: REDDIT_INSTANCE,
    name,
    handle: `r/${name}`,
    title: d.title ? decode(String(d.title)) : undefined,
    // Prefer the full sidebar text (about.json `description`); fall back to the
    // short blurb when only a search-result Thing is available.
    description: richText(
      d.description || d.public_description,
      d.description_html,
    ),
    icon,
    banner:
      typeof d.banner_background_image === "string"
        ? d.banner_background_image.split("?")[0] || undefined
        : undefined,
    subscriberCount: d.subscribers ?? 0,
    subscription: d.user_is_subscriber ? "subscribed" : "none",
    isNSFW: !!d.over18,
    isModerator: !!d.user_is_moderator,
    postingRestrictedToMods: d.submission_type === "restricted",
    permalinkRoute: communityRoute(name),
    ext: { source: "reddit" },
  };
}
