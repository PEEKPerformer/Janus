import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { Post } from "../core/model";

/**
 * Open an external URL safely. Post/comment bodies are untrusted, so we
 * allowlist http(s)/mailto and never dispatch arbitrary schemes
 * (javascript:, tel:, app deep-links) to Linking. Returns false if the scheme
 * is disallowed or the open fails, so callers can show a fallback toast.
 *
 * Whether links open in an in-app browser (SFSafariViewController, optionally
 * reader mode) or hand off to the system browser is a user preference. Rather
 * than thread settings through every call site (PostCard, PostScreen, markdown
 * links, …), the SettingsProvider pushes the current choice here via
 * {@link setLinkPreferences}; callers may still override per-call.
 */
const ALLOWED_SCHEME = /^(https?|mailto):/i;
const HTTP_SCHEME = /^https?:/i;

interface LinkPreferences {
  linkHandling: "in-app" | "browser";
  readerMode: boolean;
}

let linkPrefs: LinkPreferences = { linkHandling: "in-app", readerMode: false };

/** Synced from settings; defaults are safe before the first sync. */
export function setLinkPreferences(prefs: Partial<LinkPreferences>): void {
  linkPrefs = { ...linkPrefs, ...prefs };
}

export async function openExternal(
  url: string,
  override?: Partial<LinkPreferences>,
): Promise<boolean> {
  if (!url || !ALLOWED_SCHEME.test(url.trim())) return false;
  const target = url.trim();
  const prefs = { ...linkPrefs, ...override };
  try {
    // mailto: and other non-http schemes always hand off to the OS.
    if (prefs.linkHandling === "in-app" && HTTP_SCHEME.test(target)) {
      await WebBrowser.openBrowserAsync(target, {
        readerMode: prefs.readerMode,
        enableBarCollapsing: true,
      });
      return true;
    }
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
