/**
 * Map provider-normalized archive records (see ../archiveClient) into the unified
 * domain model, stamped with `ext.archived` provenance so the UI can never mistake
 * recovered content for live Reddit data. Reuses the same shared helpers the live
 * mappers use, so an archived card renders identically apart from its provenance.
 */
import type {
  Post,
  Comment,
  MediaItem,
  ArchiveProvenance,
} from "../../../core/model";
import type { JanusId } from "../../../core/ids";
import type { ArchiveRecord, ArchiveProviderId } from "../archiveClient";
import * as S from "./shared";

/** External-link media for an archived link post (archives carry no previews). */
function linkMedia(url?: string): {
  media: MediaItem[];
  externalLink?: string;
} {
  if (
    !url ||
    !/^https?:\/\//.test(url) ||
    /https?:\/\/([^/]*\.)?(reddit\.com|redd\.it)\b/i.test(url) ||
    /\.(jpe?g|png|gif|webp|bmp|mp4)(\?|$)/i.test(url)
  ) {
    return { media: [] };
  }
  return { media: [{ kind: "link", url, isNSFW: false }], externalLink: url };
}

export function archivedPostToPost(
  rec: ArchiveRecord,
  provider: ArchiveProviderId,
): Post {
  const { media, externalLink } = linkMedia(rec.url);
  return {
    id: S.rid("post", rec.fullname),
    dedupKey: S.rkey(rec.fullname),
    source: "reddit",
    instance: S.REDDIT_INSTANCE,
    title: rec.title ?? "",
    author: S.authorRef(rec.author),
    community: S.communityRef(rec.subreddit),
    createdAt: rec.createdAt,
    score: rec.score ?? 0,
    scoreHidden: false,
    userVote: 0,
    commentCount: 0,
    saved: false,
    isNSFW: false,
    isSpoiler: false,
    isStickied: false,
    canModerate: false,
    isRemoved: false,
    interactionStatus: "archived",
    body: S.richText(rec.selftext, rec.selftextHtml),
    media,
    externalLink,
    permalinkRoute: S.postRoute(rec.permalink ?? ""),
    ext: { source: "reddit", archived: { source: provider, reason: "hidden" } },
  };
}

export function archivedCommentToComment(
  rec: ArchiveRecord,
  postId: JanusId,
  provider: ArchiveProviderId,
  reason: ArchiveProvenance["reason"] = "hidden",
): Comment {
  return {
    id: S.rid("comment", rec.fullname),
    dedupKey: S.rkey(rec.fullname),
    source: "reddit",
    instance: S.REDDIT_INSTANCE,
    postId,
    body: S.richText(rec.body, rec.bodyHtml),
    author: S.authorRef(rec.author),
    createdAt: rec.createdAt,
    score: rec.score ?? 0,
    scoreHidden: false,
    userVote: 0,
    saved: false,
    isOP: false,
    isStickied: false,
    distinguished: null,
    depth: 0,
    childCount: 0,
    permalinkRoute: {
      source: "reddit",
      instance: S.REDDIT_INSTANCE,
      kind: "post",
      params: { permalink: rec.permalink ?? "" },
    },
    ext: { source: "reddit", archived: { source: provider, reason } },
  };
}

/** Post fullname (`t3_<id>`) for a comment record, for matching to a thread. */
export function archivePostId(rec: ArchiveRecord): JanusId | undefined {
  if (!rec.linkId) return undefined;
  return S.rid("post", rec.linkId);
}
