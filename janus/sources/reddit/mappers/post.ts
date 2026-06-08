import { decode } from "html-entities";

import type { Post, Flair, PollData } from "../../../core/model";
import * as S from "./shared";

function flair(data: any): Flair | undefined {
  if (!data.link_flair_text) return undefined;
  return {
    text: decode(data.link_flair_text),
    backgroundColor: data.link_flair_background_color || undefined,
    textColor: data.link_flair_text_color === "light" ? "#ffffff" : undefined,
  };
}

/** Reddit poll_data → unified PollData (read-only; Reddit voting needs OAuth). */
function poll(data: any): PollData | undefined {
  const p = data.poll_data;
  if (!p || !Array.isArray(p.options)) return undefined;
  const endsAt =
    typeof p.voting_end_timestamp === "number"
      ? p.voting_end_timestamp
      : undefined;
  return {
    options: p.options.map((o: any) => ({
      id: String(o.id),
      text: decode(o.text ?? ""),
      voteCount: typeof o.vote_count === "number" ? o.vote_count : undefined,
    })),
    totalVotes: p.total_vote_count ?? 0,
    endsAt,
    closed: endsAt !== undefined ? endsAt < Date.now() : false,
    userSelection:
      p.user_selection != null ? String(p.user_selection) : undefined,
  };
}

/** Map a raw Reddit `t3` Thing (`{ kind, data }`) to a unified Post. */
export function mapPost(child: any): Post {
  const data = child.data;
  const { media, thumbnail, externalLink } = S.extractMedia(data);

  const crossRaw = data.crosspost_parent_list?.[0];
  const crossPost = crossRaw ? mapPost({ data: crossRaw }) : undefined;

  return {
    id: S.rid("post", data.name),
    dedupKey: S.rkey(data.name),
    source: "reddit",
    instance: S.REDDIT_INSTANCE,
    title: decode(data.title ?? ""),
    author: S.authorRef(data.author),
    community: S.communityRef(data.subreddit, S.subredditIcon(data.sr_detail)),
    createdAt: (data.created ?? 0) * 1000,
    editedAt: data.edited ? data.edited * 1000 : undefined,
    score: data.ups ?? 0,
    scoreHidden: !!data.score_hidden,
    userVote: S.voteFromLikes(data.likes),
    commentCount: data.num_comments ?? 0,
    saved: !!data.saved,
    isNSFW: !!data.over_18,
    isSpoiler: !!data.spoiler,
    isStickied: !!data.stickied,
    interactionStatus: data.archived
      ? "archived"
      : data.locked
        ? "locked"
        : null,
    body: S.richText(data.selftext, data.selftext_html),
    media,
    externalLink,
    thumbnail,
    poll: poll(data),
    permalinkRoute: S.postRoute(data.permalink),
    flair: flair(data),
    ext: {
      source: "reddit",
      crossPost,
      distinguished:
        data.distinguished === "moderator"
          ? "moderator"
          : data.distinguished === "admin"
            ? "admin"
            : null,
    },
  };
}
