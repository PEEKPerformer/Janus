import { Linking } from "react-native";
import type { Post } from "../core/model";

/**
 * Open an external URL safely. Post/comment bodies are untrusted, so we
 * allowlist http(s)/mailto and never dispatch arbitrary schemes
 * (javascript:, tel:, app deep-links) to Linking. Returns false if the scheme
 * is disallowed or the open fails, so callers can show a fallback toast.
 */
const ALLOWED_SCHEME = /^(https?|mailto):/i;

export async function openExternal(url: string): Promise<boolean> {
  if (!url || !ALLOWED_SCHEME.test(url.trim())) return false;
  try {
    const target = url.trim();
    const ok = await Linking.canOpenURL(target);
    if (!ok) return false;
    await Linking.openURL(target);
    return true;
  } catch {
    return false;
  }
}

export function isHttpUrl(url?: string | null): boolean {
  return !!url && /^https?:\/\/\S+/i.test(url.trim());
}

export function hostname(url: string): string {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1].replace(/^www\./, "") : url;
}

/** Canonical, shareable web URL for a post (Reddit permalink / Lemmy ap_id). */
export function postShareUrl(post: Post): string {
  if (post.source === "reddit") {
    const permalink = post.permalinkRoute?.params?.permalink;
    return permalink
      ? `https://www.reddit.com${permalink}`
      : `https://www.reddit.com`;
  }
  // Lemmy: the federation ap_id is the canonical cross-instance URL.
  const apId = post.ext.source === "lemmy" ? post.ext.apId : undefined;
  if (apId) return apId;
  const id = post.permalinkRoute?.params?.id;
  return id
    ? `https://${post.instance}/post/${id}`
    : `https://${post.instance}`;
}
