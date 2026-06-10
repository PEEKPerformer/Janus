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
  /** Which app to hand http(s) links to in "browser" mode. */
  externalBrowser: "default" | "chrome" | "firefox";
}

let linkPrefs: LinkPreferences = {
  linkHandling: "in-app",
  readerMode: false,
  externalBrowser: "default",
};

/** Rewrite an http(s) URL into a specific browser's deep-link scheme. */
function browserSchemeUrl(
  browser: LinkPreferences["externalBrowser"],
  url: string,
): string | null {
  if (browser === "chrome")
    return url
      .replace(/^http:/i, "googlechrome:")
      .replace(/^https:/i, "googlechromes:");
  if (browser === "firefox")
    return `firefox://open-url?url=${encodeURIComponent(url)}`;
  return null;
}

/** Synced from settings; defaults are safe before the first sync. */
export function setLinkPreferences(prefs: Partial<LinkPreferences>): void {
  linkPrefs = { ...linkPrefs, ...prefs };
}

/**
 * In-app URL routing (registered by DeepLinkHandler, same pattern as the
 * image-viewer opener): a reddit/lemmy share URL tapped inside a comment
 * should open the post/community/profile screen, not kick you to a browser.
 */
let inAppUrlRouter: ((url: string) => Promise<boolean>) | null = null;

export function setInAppUrlRouter(
  fn: ((url: string) => Promise<boolean>) | null,
): void {
  inAppUrlRouter = fn;
}

/** Try in-app routing first; anything unroutable opens like any other link. */
export async function openLink(url: string): Promise<boolean> {
  if (inAppUrlRouter) {
    const routed = await inAppUrlRouter(url).catch(() => false);
    if (routed) return true;
  }
  return openExternal(url);
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
    // Browser mode with a specific browser: try its scheme, fall back to system.
    if (
      prefs.linkHandling === "browser" &&
      prefs.externalBrowser !== "default" &&
      HTTP_SCHEME.test(target)
    ) {
      const alt = browserSchemeUrl(prefs.externalBrowser, target);
      if (alt && (await Linking.canOpenURL(alt))) {
        await Linking.openURL(alt);
        return true;
      }
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
