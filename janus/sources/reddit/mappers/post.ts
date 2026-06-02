/* eslint-disable @typescript-eslint/no-explicit-any */
import { decode } from "html-entities";

import type { Post, Flair } from "../../../core/model";
import * as S from "./shared";

function flair(data: any): Flair | undefined {
  if (!data.link_flair_text) return undefined;
  return {
    text: decode(data.link_flair_text),
    backgroundColor: data.link_flair_background_color || undefined,
    textColor: data.link_flair_text_color === "light" ? "#ffffff" : undefined,
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
    interactionStatus: data.archived ? "archived" : data.locked ? "locked" : null,
    body: S.richText(data.selftext, data.selftext_html),
    media,
    externalLink,
    thumbnail,
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
