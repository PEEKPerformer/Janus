/**
 * Pure mappers: Lemmy v3 API views (PostView / CommentView / CommunityView /
 * PersonView) -> Janus unified domain model. No network — fully unit-testable.
 *
 * Federation notes:
 *  - canonical JanusId is keyed on the HOME instance we fetched from; the
 *    federation-stable dedupKey is the object's `ap_id`.
 *  - handles are instance-qualified for remote actors (Voyager's rule):
 *    local ? name : `name@<host-of-ap_id>`.
 *  - the comment tree comes from the dotted `path` ("0.parent.id"): depth =
 *    segments - 2, parent = the second-to-last segment (none => top-level).
 */

import {
  buildId,
  dedupKey,
  type JanusId,
  type EntityKind,
} from "../../core/ids";
import { toVote } from "../../core/vote";
import type {
  Post,
  Comment,
  Community,
  User,
  RichText,
  AuthorRef,
  CommunityRef,
  MediaItem,
  Route,
} from "../../core/model";
import type { SubscribedState } from "../../core/capabilities";

export const LEMMY_SOURCE = "lemmy" as const;

export function lid(
  instance: string,
  kind: EntityKind,
  nativeId: string | number,
): JanusId {
  return buildId({
    source: LEMMY_SOURCE,
    instance,
    kind,
    nativeId: String(nativeId),
  });
}

/** Host portion of an ActivityPub actor/object id ("https://lemmy.ml/c/x" -> "lemmy.ml"). */
export function hostOf(apId: string): string {
  try {
    return new URL(apId).host;
  } catch {
    return "";
  }
}

/** local ? name : name@host (Voyager's Handle rule for federated actors). */
export function handle(name: string, local: boolean, apId: string): string {
  if (local) return name;
  const host = hostOf(apId);
  return host ? `${name}@${host}` : name;
}

/** Lemmy publishes ISO timestamps, sometimes WITHOUT a trailing Z (UTC). */
export function lemmyTime(iso?: string | null): number {
  if (!iso) return 0;
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? 0 : ms;
}

export function subscribedState(s: string | undefined): SubscribedState {
  if (s === "Subscribed") return "subscribed";
  if (s === "Pending") return "pending";
  return "none";
}

export function markdown(content?: string | null): RichText {
  if (!content) return {};
  return { markdown: content, text: content };
}

function authorRef(instance: string, person: any): AuthorRef {
  return {
    id: lid(instance, "user", person.id),
    username: person.name,
    handle: handle(person.name, !!person.local, person.actor_id ?? ""),
    avatarUrl: person.avatar || undefined,
  };
}

function communityRef(instance: string, community: any): CommunityRef {
  return {
    id: lid(instance, "community", community.id),
    name: community.name,
    handle: handle(community.name, !!community.local, community.actor_id ?? ""),
    icon: community.icon || undefined,
  };
}

function postMedia(post: any): {
  media: MediaItem[];
  thumbnail?: MediaItem;
  externalLink?: string;
} {
  const url: string | undefined = post.url;
  if (!url) return { media: [] };
  const isNSFW = !!post.nsfw;
  // Direct video links play natively (webm is excluded: iOS AVPlayer can't
  // decode it, so it stays a click-through link). .gifv is an mp4 in disguise.
  const isVideo =
    (post.url_content_type &&
      String(post.url_content_type).startsWith("video/") &&
      !/webm/i.test(String(post.url_content_type))) ||
    /\.(mp4|mov|m3u8|gifv)(\?|$)/i.test(url);
  if (isVideo) {
    const item: MediaItem = {
      kind: "video",
      url: url.replace(/\.gifv(\?|$)/i, ".mp4$1"),
      hlsUrl: /\.m3u8(\?|$)/i.test(url) ? url : undefined,
      thumbnailUrl: post.thumbnail_url || undefined,
      isGif: /\.gifv(\?|$)/i.test(url) || undefined,
      isNSFW,
    };
    return { media: [item], thumbnail: item };
  }
  const isImage =
    (post.url_content_type &&
      String(post.url_content_type).startsWith("image/")) ||
    /\.(jpe?g|png|gif|webp|bmp)$/i.test(url);
  if (isImage) {
    const item: MediaItem = {
      kind: "image",
      url,
      thumbnailUrl: post.thumbnail_url || undefined,
      width: post.image_details?.width,
      height: post.image_details?.height,
      aspectRatio:
        post.image_details?.width && post.image_details?.height
          ? post.image_details.width / post.image_details.height
          : undefined,
      isNSFW,
    };
    return { media: [item], thumbnail: item };
  }
  const link: MediaItem = {
    kind: "link",
    url,
    thumbnailUrl: post.thumbnail_url || undefined,
    isNSFW,
  };
  return {
    media: [link],
    thumbnail: post.thumbnail_url ? link : undefined,
    externalLink: url,
  };
}

function postRoute(instance: string, id: number): Route {
  return {
    source: LEMMY_SOURCE,
    instance,
    kind: "post",
    params: { id: String(id) },
  };
}

export function mapLemmyPost(
  pv: any,
  instance: string,
  canModerate = false,
): Post {
  const post = pv.post;
  const { media, thumbnail, externalLink } = postMedia(post);
  return {
    id: lid(instance, "post", post.id),
    dedupKey: dedupKey(post.ap_id),
    source: "lemmy",
    instance,
    title: post.name,
    author: authorRef(instance, pv.creator),
    community: communityRef(instance, pv.community),
    createdAt: lemmyTime(post.published),
    editedAt: post.updated ? lemmyTime(post.updated) : undefined,
    score: pv.counts?.score ?? 0,
    scoreHidden: false, // Lemmy has no hide-score
    userVote: toVote(pv.my_vote),
    commentCount: pv.counts?.comments ?? 0,
    saved: !!pv.saved,
    isNSFW: !!post.nsfw,
    isSpoiler: false,
    isStickied: !!post.featured_community || !!post.featured_local,
    canModerate,
    isRemoved: !!post.removed,
    interactionStatus: post.locked ? "locked" : null,
    body: markdown(post.body),
    media,
    externalLink,
    thumbnail,
    permalinkRoute: postRoute(instance, post.id),
    ext: {
      source: "lemmy",
      apId: post.ap_id,
      local: !!post.local,
      featuredLocal: !!post.featured_local,
      featuredCommunity: !!post.featured_community,
      read: !!pv.read,
    },
  };
}

/** Parse Lemmy's dotted comment path. path[0] is always "0" (the post root). */
export function parsePath(path: string): {
  depth: number;
  parentNativeId?: string;
} {
  const segs = path.split(".");
  const depth = Math.max(0, segs.length - 2);
  const parentNativeId = segs.length > 2 ? segs[segs.length - 2] : undefined;
  return { depth, parentNativeId };
}

export function mapLemmyComment(
  cv: any,
  postId: JanusId,
  instance: string,
): Comment {
  const c = cv.comment;
  const { depth, parentNativeId } = parsePath(c.path);
  const isOP = cv.post && c.creator_id === cv.post.creator_id;
  return {
    id: lid(instance, "comment", c.id),
    dedupKey: dedupKey(c.ap_id),
    source: "lemmy",
    instance,
    postId,
    parentId: parentNativeId
      ? lid(instance, "comment", parentNativeId)
      : undefined,
    author: authorRef(instance, cv.creator),
    body: markdown(c.content),
    createdAt: lemmyTime(c.published),
    editedAt: c.updated ? lemmyTime(c.updated) : undefined,
    score: cv.counts?.score ?? 0,
    scoreHidden: false,
    userVote: toVote(cv.my_vote),
    saved: !!cv.saved,
    isOP: !!isOP,
    isStickied: false,
    distinguished: c.distinguished ? "moderator" : null,
    depth,
    childCount: cv.counts?.child_count ?? 0,
    permalinkRoute: {
      source: LEMMY_SOURCE,
      instance,
      kind: "post",
      params: { id: String(c.post_id) },
    },
    // Out-of-thread context for profile/saved listings; the CommentView from
    // /user carries the post and community alongside each comment.
    context: cv.community
      ? {
          community: communityRef(instance, cv.community),
          postTitle: cv.post?.name || undefined,
        }
      : undefined,
    ext: { source: "lemmy", apId: c.ap_id, local: !!c.local },
  };
}

export function mapLemmyCommunity(cv: any, instance: string): Community {
  const c = cv.community ?? cv;
  return {
    id: lid(instance, "community", c.id),
    dedupKey: dedupKey(c.actor_id),
    source: "lemmy",
    instance,
    name: c.name,
    handle: handle(c.name, !!c.local, c.actor_id ?? ""),
    title: c.title || undefined,
    description: markdown(c.description),
    icon: c.icon || undefined,
    banner: c.banner || undefined,
    subscriberCount: cv.counts?.subscribers ?? 0,
    subscription: subscribedState(cv.subscribed),
    isNSFW: !!c.nsfw,
    isModerator: false,
    postingRestrictedToMods: !!c.posting_restricted_to_mods,
    permalinkRoute: {
      source: LEMMY_SOURCE,
      instance,
      kind: "community",
      params: { id: String(c.id) },
    },
    ext: { source: "lemmy", apId: c.actor_id, local: !!c.local },
  };
}

export function mapLemmyPerson(pv: any, instance: string): User {
  const p = pv.person ?? pv;
  return {
    id: lid(instance, "user", p.id),
    dedupKey: dedupKey(p.actor_id),
    source: "lemmy",
    instance,
    username: p.name,
    handle: handle(p.name, !!p.local, p.actor_id ?? ""),
    displayName: p.display_name || undefined,
    avatar: p.avatar || undefined,
    banner: p.banner || undefined,
    bio: markdown(p.bio),
    createdAt: lemmyTime(p.published),
    isBot: !!p.bot_account,
    isAdmin: !!p.admin,
    postScore: pv.counts?.post_score,
    commentScore: pv.counts?.comment_score,
    ext: { source: "lemmy", apId: p.actor_id, local: !!p.local },
  };
}
