import type { Post } from "../core/model";

/**
 * Cross-network repost collapse — Janus's headline trick. The same news link or
 * image posted to r/news, lemmy.world and lemmy.ml is one *thing*; showing it
 * five times is noise. We fold same-content posts across communities AND
 * networks into a single lead card that carries its "companions" (the other
 * discussions), so you scroll the story once and can still jump into any side's
 * comments.
 *
 * Matching is by normalized content URL (external link, or a hosted media URL),
 * which reliably catches link posts and identical-URL media — the bulk of real
 * cross-posting, especially news. Text/self posts are never collapsed: two
 * self-posts with the same title are genuinely different conversations.
 * (Perceptual image hashing — catching the same picture re-uploaded to each
 * instance — is a future upgrade; URL matching is the honest v1.)
 */

export interface FeedEntry {
  /** The post shown in the feed (first occurrence, preserving feed order). */
  post: Post;
  /** Other posts of the same content in *different* communities, most-discussed first. */
  companions: Post[];
}

// Query params that are tracking/ephemeral and must not split a match.
const DROP_PARAM = /^(utm_|ref$|ref_|si$|share|context$|feature$|s$|t$)/i;
// Hosts whose query string is a per-fetch signing token, not identity.
const MEDIA_HOST =
  /(redd\.it|redditmedia|imgur\.com|redgifs\.com|gfycat|catbox\.moe|pict-rs|\/pictrs\/|files\.catbox)/i;

function isHttp(u?: string | null): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

/** Canonicalize a URL so trivially-different links to the same thing match. */
export function normalizeContentUrl(raw: string): string | null {
  const m = /^https?:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(raw.trim());
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/^www\./, "");
  const path = m[2].replace(/\/+$/, "");
  let query = "";
  if (m[3] && !MEDIA_HOST.test(host)) {
    const params = new URLSearchParams(m[3].slice(1));
    const keep: [string, string][] = [];
    for (const [k, v] of params) {
      if (!DROP_PARAM.test(k)) keep.push([k, v]);
    }
    keep.sort((a, b) => a[0].localeCompare(b[0]));
    if (keep.length) {
      query = "?" + keep.map(([k, v]) => `${k}=${v}`).join("&");
    }
  }
  return `${host}${path}${query}`;
}

/** The content identity of a post, or null when it shouldn't be collapsed. */
export function contentKey(post: Post): string | null {
  const ext =
    post.externalLink ?? post.media.find((m) => m.kind === "link")?.url;
  if (isHttp(ext)) return normalizeContentUrl(ext);
  const media = post.media.find(
    (m) => m.kind === "image" || m.kind === "gallery" || m.kind === "video",
  );
  if (media) {
    const u = isHttp(media.url) ? media.url : media.hlsUrl;
    if (isHttp(u)) return normalizeContentUrl(u);
  }
  return null; // self / poll / text → never collapsed
}

/**
 * Fold same-content posts into lead+companions, preserving the feed's order by
 * each group's first occurrence. Companions are the same content in *other*
 * communities (sorted most-discussed first); exact same-community dupes are
 * de-duplicated away silently.
 */
export function collapseCrossposts(posts: Post[]): FeedEntry[] {
  const groups = new Map<string, Post[]>();
  for (const p of posts) {
    const key = contentKey(p);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  const consumed = new Set<string>();
  const out: FeedEntry[] = [];
  for (const post of posts) {
    if (consumed.has(post.id)) continue;
    const key = contentKey(post);
    const group = key ? groups.get(key) : undefined;
    if (!group || group.length <= 1) {
      out.push({ post, companions: [] });
      continue;
    }
    // `post` is this group's lead (first time we reach it in feed order).
    const companions = group
      .filter((g) => g.id !== post.id && g.community.id !== post.community.id)
      .sort((a, b) => b.commentCount - a.commentCount);
    for (const g of group) if (g.id !== post.id) consumed.add(g.id);
    out.push({ post, companions });
  }
  return out;
}
