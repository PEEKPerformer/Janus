/**
 * Shared, pure helpers for mapping raw Reddit `.json` Thing data into the Janus
 * unified domain model. No network, no React Native — so the mappers built on
 * top are fully unit-testable. The media-extraction logic is ported from
 * Hydra's formatImages/formatVideos (minus the network-dependent OpenGraph /
 * RedGifs resolution, which the prototype defers).
 */

import { decode } from "html-entities";

import {
  buildId,
  dedupKey,
  type JanusId,
  type DedupKey,
  type EntityKind,
} from "../../../core/ids";
import { Vote } from "../../../core/vote";
import type {
  RichText,
  AuthorRef,
  CommunityRef,
  MediaItem,
  Route,
} from "../../../core/model";

export const REDDIT_SOURCE = "reddit" as const;
export const REDDIT_INSTANCE = "www.reddit.com";

export function rid(kind: EntityKind, nativeId: string): JanusId {
  return buildId({
    source: REDDIT_SOURCE,
    instance: REDDIT_INSTANCE,
    kind,
    nativeId,
  });
}

/** Reddit has no federation, so the dedup key is just the native fullname. */
export function rkey(fullname: string): DedupKey {
  return dedupKey(fullname);
}

export function richText(
  markdown?: string | null,
  html?: string | null,
): RichText {
  const out: RichText = {};
  if (markdown) {
    out.markdown = markdown;
    out.text = markdown;
  }
  if (html) out.html = decode(html);
  return out;
}

export function authorRef(author: string): AuthorRef {
  return { id: rid("user", author), username: author, handle: `u/${author}` };
}

export function communityRef(subreddit: string, icon?: string): CommunityRef {
  return {
    id: rid("community", subreddit),
    name: subreddit,
    handle: `r/${subreddit}`,
    icon: icon || undefined,
  };
}

export function voteFromLikes(likes: boolean | null | undefined): Vote {
  if (likes === true) return Vote.Up;
  if (likes === false) return Vote.Down;
  return Vote.None;
}

export function postRoute(permalink: string): Route {
  return {
    source: REDDIT_SOURCE,
    instance: REDDIT_INSTANCE,
    kind: "post",
    params: { permalink },
  };
}

export function communityRoute(subreddit: string): Route {
  return {
    source: REDDIT_SOURCE,
    instance: REDDIT_INSTANCE,
    kind: "community",
    params: { name: subreddit },
  };
}

export function userRoute(username: string): Route {
  return {
    source: REDDIT_SOURCE,
    instance: REDDIT_INSTANCE,
    kind: "user",
    params: { name: username },
  };
}

export function subredditIcon(srDetail: any): string | undefined {
  if (!srDetail) return undefined;
  const community = srDetail.community_icon as string | undefined;
  if (community) return community.split("?")[0];
  return (srDetail.icon_img as string | undefined) || undefined;
}

export interface ExtractedMedia {
  media: MediaItem[];
  thumbnail?: MediaItem;
  externalLink?: string;
}

/** Pure subset of Hydra's formatImages/formatVideos producing unified MediaItem[]. */
export function extractMedia(data: any): ExtractedMedia {
  const isNSFW = !!data.over_18;
  const media: MediaItem[] = [];

  // Reddit-hosted video (HLS).
  const redditVideo =
    data.media?.reddit_video ?? data.secure_media?.reddit_video;
  if (redditVideo?.hls_url) {
    media.push({
      kind: "video",
      url: redditVideo.fallback_url ?? redditVideo.hls_url,
      hlsUrl: redditVideo.hls_url,
      width: redditVideo.width,
      height: redditVideo.height,
      isGif: !!redditVideo.is_gif || undefined,
      isNSFW,
    });
  }

  // GIF / RedGifs / gifv embeds surface a playable rendition here even when
  // media.reddit_video is absent (rich:video links and video crossposts).
  const rvp = data.preview?.reddit_video_preview;
  if (media.length === 0 && (rvp?.hls_url || rvp?.fallback_url)) {
    media.push({
      kind: "video",
      url: rvp.fallback_url ?? rvp.hls_url,
      hlsUrl: rvp.hls_url,
      width: rvp.width,
      height: rvp.height,
      isGif: !!rvp.is_gif || undefined,
      isNSFW,
    });
  }
  const videoItem = media.find((m) => m.kind === "video");

  // Single preview image.
  const previewImages = data.preview?.images;
  if (previewImages?.length) {
    for (const img of previewImages) {
      const variants = (img.resolutions ?? []).map((r: any) => ({
        uri: decode(r.url),
        width: r.width,
        height: r.height,
      }));
      const source = img.source
        ? {
            uri: decode(img.source.url),
            width: img.source.width,
            height: img.source.height,
          }
        : variants[variants.length - 1];
      // GIF posts: preview.source is a STILL — the animation lives in the mp4
      // variant. Surface that as a silent looping video so gifs actually move.
      const animatedMp4 = img.variants?.mp4?.source?.url;
      if (animatedMp4 && !videoItem) {
        media.push({
          kind: "video",
          url: decode(animatedMp4),
          width: img.variants.mp4.source.width,
          height: img.variants.mp4.source.height,
          aspectRatio:
            img.variants.mp4.source.width && img.variants.mp4.source.height
              ? img.variants.mp4.source.width / img.variants.mp4.source.height
              : undefined,
          thumbnailUrl: variants[0]?.uri ?? source?.uri,
          isGif: true,
          isNSFW,
        });
        continue;
      }
      if (!source) continue;
      // A video post's preview is its poster, not a second medium — folding it
      // in (instead of pushing an image) keeps the reel from showing a frozen
      // duplicate slide next to every video.
      if (videoItem) {
        if (!videoItem.thumbnailUrl)
          videoItem.thumbnailUrl = variants[0]?.uri ?? source.uri;
        if (!videoItem.aspectRatio && source.width && source.height)
          videoItem.aspectRatio = source.width / source.height;
        continue;
      }
      media.push({
        kind: "image",
        url: source.uri,
        width: source.width,
        height: source.height,
        aspectRatio:
          source.width && source.height
            ? source.width / source.height
            : undefined,
        thumbnailUrl: variants[0]?.uri,
        variants,
        isNSFW,
      });
    }
  }

  // Gallery (media_metadata ordered by gallery_data).
  const galleryItems = data.gallery_data?.items;
  if (galleryItems?.length && data.media_metadata) {
    const order: Record<string, number> = {};
    galleryItems.forEach((it: any, i: number) => (order[it.media_id] = i));
    const entries = Object.values<any>(data.media_metadata)
      .filter((m: any) => m.p)
      .sort((a: any, b: any) => (order[a.id] ?? 0) - (order[b.id] ?? 0));
    for (const m of entries) {
      const sizes = (m.p ?? []).map((p: any) => ({
        uri: decode(p.u),
        width: p.x,
        height: p.y,
      }));
      // Animated gallery entries carry s.gif/s.mp4 instead of s.u — use the
      // gif rendition so every image surface (expo-image animates gifs) plays
      // it, rather than degrading to a static thumbnail.
      if (m.s?.gif) {
        media.push({
          kind: "gallery",
          url: decode(m.s.gif),
          width: m.s.x,
          height: m.s.y,
          aspectRatio: m.s.x && m.s.y ? m.s.x / m.s.y : undefined,
          thumbnailUrl: sizes[0]?.uri,
          variants: sizes,
          isGif: true,
          isNSFW,
        });
        continue;
      }
      const src = m.s?.u
        ? { uri: decode(m.s.u), width: m.s.x, height: m.s.y }
        : sizes[sizes.length - 1];
      if (!src) continue;
      media.push({
        kind: "gallery",
        url: src.uri,
        width: src.width,
        height: src.height,
        aspectRatio:
          src.width && src.height ? src.width / src.height : undefined,
        thumbnailUrl: sizes[0]?.uri,
        variants: sizes,
        isNSFW,
      });
    }
  }

  // Direct media link with no preview payload (older posts, some hosts):
  // .gifv is imgur's html wrapper around an mp4 at the same path.
  const directUrl: string | undefined = data.url;
  if (
    media.length === 0 &&
    typeof directUrl === "string" &&
    /^https?:\/\//.test(directUrl)
  ) {
    if (/\.gifv(\?|$)/i.test(directUrl)) {
      media.push({
        kind: "video",
        url: directUrl.replace(/\.gifv/i, ".mp4"),
        isGif: true,
        isNSFW,
      });
    } else if (/\.(mp4|mov)(\?|$)/i.test(directUrl)) {
      media.push({ kind: "video", url: directUrl, isNSFW });
    } else if (/\.m3u8(\?|$)/i.test(directUrl)) {
      media.push({
        kind: "video",
        url: directUrl,
        hlsUrl: directUrl,
        isNSFW,
      });
    } else if (/\.(gif|jpe?g|png|webp|bmp)(\?|$)/i.test(directUrl)) {
      media.push({ kind: "image", url: directUrl, isNSFW });
    }
  }

  // Crossposted video: the child Thing often has no media of its own — the
  // playable streams live on the parent.
  if (media.length === 0 && data.crosspost_parent_list?.length) {
    const parent = extractMedia(data.crosspost_parent_list[0]);
    media.push(...parent.media.filter((m) => m.kind !== "link"));
  }

  // External link: an off-site http(s) url. A link post can ALSO carry a preview
  // image (Reddit attaches one), so this must NOT be gated on "no media" — doing
  // so misclassified link-with-preview posts as image posts and hid the link.
  // Direct images/videos/galleries/self-posts are excluded so they stay viewable
  // rather than being treated as click-through links.
  let externalLink: string | undefined;
  const url: string | undefined = data.url;
  const isDirectMedia =
    data.post_hint === "image" ||
    data.post_hint === "hosted:video" ||
    data.post_hint === "rich:video" ||
    !!data.is_gallery ||
    (typeof url === "string" &&
      /\.(jpe?g|png|gif|gifv|webp|bmp|mp4|mov|m3u8)(\?|$)/i.test(url));
  if (
    url &&
    /^https?:\/\//.test(url) &&
    !data.is_self &&
    !isDirectMedia &&
    !/https?:\/\/([^/]*\.)?(reddit\.com|redd\.it)\b/i.test(url)
  ) {
    externalLink = url;
    if (media.length === 0) media.push({ kind: "link", url, isNSFW });
  }

  const thumbnail =
    media.find((m) => m.kind === "image" || m.kind === "gallery") ?? media[0];
  return { media, thumbnail, externalLink };
}
