import * as SecureStore from "expo-secure-store";
import type { JanusId } from "../core/ids";

/**
 * Unified app preferences. The whole point of Janus is one settings surface that
 * BOTH sources obey — so a single "default sort" or "blur NSFW" toggle is read by
 * the Reddit and Lemmy adapters alike, never forked per source. The few things
 * that are intrinsically per-origin (which account, which instance) live in
 * {@link ./accountStore}; everything here is source-agnostic behaviour/appearance.
 *
 * Persisted as one JSON blob under a versioned key, matching the other stores.
 * Unknown/missing fields fall back to {@link DEFAULT_SETTINGS}, so adding a field
 * later is forward-compatible with an old stored blob.
 */

export type PostLayout = "compact" | "comfortable";
export type Appearance = "system" | "light" | "dark";
export type FeedMode = "subscribed" | "all" | "local";
export type TimeWindow = "hour" | "day" | "week" | "month" | "year" | "all";
export type LinkHandling = "in-app" | "browser";
/**
 * How the unified ("All") feed blends Reddit vs Lemmy. "balanced" is a 1:1
 * round-robin; the others bias the interleave toward one side (≈3:1) for people
 * whose centre of gravity is one network. Single-source feeds ignore this.
 */
export type FeedMix = "balanced" | "reddit" | "lemmy";

/** Actions a swipe slot can map to. Limited to what the feed can actually do. */
export type SwipeActionId = "none" | "upvote" | "downvote" | "save";

/**
 * Four graduated swipe slots (Apollo/Voyager/Hydra-style): right & left, each a
 * short and a long throw. Right defaults to vote, left to save — but every slot
 * is user-remappable.
 */
export interface SwipeConfig {
  rightShort: SwipeActionId;
  rightLong: SwipeActionId;
  leftShort: SwipeActionId;
  leftLong: SwipeActionId;
}

export interface PostFilters {
  /** Case-insensitive substrings; a post matching any is hidden. */
  keywords: string[];
  /** JanusIds of communities whose posts are hidden everywhere. */
  mutedCommunities: JanusId[];
  /** JanusIds of authors whose posts are hidden everywhere. */
  mutedUsers: JanusId[];
}

/** Which browser external links open in when linkHandling is "browser". */
export type ExternalBrowser = "default" | "chrome" | "firefox";

export interface JanusSettings {
  // Appearance
  postLayout: PostLayout;
  appearance: Appearance;
  /** Custom accent hex ("#rrggbb") or "" for the default. */
  themeAccent: string;
  /** True-black backgrounds in dark mode (OLED). */
  oledBlack: boolean;
  fontScale: number;
  blurNsfw: boolean;
  /** Blur spoiler-marked content (independent of NSFW). */
  blurSpoilers: boolean;
  /** Max lines a post title shows in the feed (1–6). */
  titleMaxLines: number;
  /** Autoplay feed videos (muted) instead of tap-to-play. */
  autoplayVideo: boolean;
  // Feed behaviour
  defaultFeed: FeedMode;
  feedMix: FeedMix;
  defaultPostSort: string;
  topTimeWindow: TimeWindow;
  defaultCommentSort: string;
  hideNsfw: boolean;
  /** Hide posts you've already opened. */
  hideSeenPosts: boolean;
  /** Remember the last sort you used per community. */
  rememberCommunitySort: boolean;
  /** Start AutoModerator comments collapsed. */
  collapseAutoModerator: boolean;
  /** Two-pane feed + detail layout on wide screens (iPad). */
  splitView: boolean;
  /** Collapse the same content reposted across communities/networks into one card. */
  collapseCrossNetwork: boolean;
  // General
  linkHandling: LinkHandling;
  externalBrowser: ExternalBrowser;
  readerMode: boolean;
  haptics: boolean;
  // Gestures
  swipe: SwipeConfig;
  // Filters & blocks
  filters: PostFilters;
}

export const DEFAULT_SWIPE: SwipeConfig = {
  rightShort: "upvote",
  rightLong: "downvote",
  leftShort: "save",
  leftLong: "none",
};

export const DEFAULT_SETTINGS: JanusSettings = {
  postLayout: "compact",
  appearance: "system",
  themeAccent: "",
  oledBlack: false,
  fontScale: 1,
  blurNsfw: true,
  blurSpoilers: true,
  titleMaxLines: 3,
  autoplayVideo: false,
  defaultFeed: "subscribed",
  feedMix: "balanced",
  defaultPostSort: "hot",
  topTimeWindow: "day",
  defaultCommentSort: "top",
  hideNsfw: false,
  hideSeenPosts: false,
  rememberCommunitySort: true,
  collapseAutoModerator: false,
  splitView: true,
  collapseCrossNetwork: true,
  linkHandling: "in-app",
  externalBrowser: "default",
  readerMode: false,
  haptics: true,
  swipe: { ...DEFAULT_SWIPE },
  filters: { keywords: [], mutedCommunities: [], mutedUsers: [] },
};

const KEY = "janus.settings.v1";

const FONT_MIN = 0.85;
const FONT_MAX = 1.4;

const SWIPE_ACTIONS: readonly SwipeActionId[] = [
  "none",
  "upvote",
  "downvote",
  "save",
];

function clampFont(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 1;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, n));
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function coerceSwipe(v: unknown): SwipeConfig {
  const o = (v ?? {}) as Record<string, unknown>;
  const pick = (k: keyof SwipeConfig): SwipeActionId =>
    SWIPE_ACTIONS.includes(o[k] as SwipeActionId)
      ? (o[k] as SwipeActionId)
      : DEFAULT_SWIPE[k];
  return {
    rightShort: pick("rightShort"),
    rightLong: pick("rightLong"),
    leftShort: pick("leftShort"),
    leftLong: pick("leftLong"),
  };
}

/**
 * Merge a stored (possibly partial / older-shape) blob over the defaults and
 * coerce every field to a safe value. Never throws — a corrupt blob yields
 * defaults, so the app always boots.
 */
export function coerceSettings(raw: unknown): JanusSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const oneOf = <T extends string>(
    v: unknown,
    allowed: readonly T[],
    fb: T,
  ): T => (allowed.includes(v as T) ? (v as T) : fb);
  return {
    postLayout: oneOf(
      o.postLayout,
      ["compact", "comfortable"] as const,
      "compact",
    ),
    appearance: oneOf(
      o.appearance,
      ["system", "light", "dark"] as const,
      "system",
    ),
    themeAccent:
      typeof o.themeAccent === "string" &&
      /^#?[0-9a-fA-F]{6}$/.test(o.themeAccent)
        ? o.themeAccent
        : "",
    oledBlack: typeof o.oledBlack === "boolean" ? o.oledBlack : false,
    fontScale: clampFont(o.fontScale),
    blurNsfw: typeof o.blurNsfw === "boolean" ? o.blurNsfw : true,
    blurSpoilers: typeof o.blurSpoilers === "boolean" ? o.blurSpoilers : true,
    titleMaxLines:
      typeof o.titleMaxLines === "number"
        ? Math.min(6, Math.max(1, Math.round(o.titleMaxLines)))
        : 3,
    autoplayVideo:
      typeof o.autoplayVideo === "boolean" ? o.autoplayVideo : false,
    defaultFeed: oneOf(
      o.defaultFeed,
      ["subscribed", "all", "local"] as const,
      "subscribed",
    ),
    feedMix: oneOf(
      o.feedMix,
      ["balanced", "reddit", "lemmy"] as const,
      "balanced",
    ),
    defaultPostSort:
      typeof o.defaultPostSort === "string" ? o.defaultPostSort : "hot",
    topTimeWindow: oneOf(
      o.topTimeWindow,
      ["hour", "day", "week", "month", "year", "all"] as const,
      "day",
    ),
    defaultCommentSort:
      typeof o.defaultCommentSort === "string" ? o.defaultCommentSort : "top",
    hideNsfw: typeof o.hideNsfw === "boolean" ? o.hideNsfw : false,
    hideSeenPosts:
      typeof o.hideSeenPosts === "boolean" ? o.hideSeenPosts : false,
    rememberCommunitySort:
      typeof o.rememberCommunitySort === "boolean"
        ? o.rememberCommunitySort
        : true,
    collapseAutoModerator:
      typeof o.collapseAutoModerator === "boolean"
        ? o.collapseAutoModerator
        : false,
    splitView: typeof o.splitView === "boolean" ? o.splitView : true,
    collapseCrossNetwork:
      typeof o.collapseCrossNetwork === "boolean"
        ? o.collapseCrossNetwork
        : true,
    linkHandling: oneOf(
      o.linkHandling,
      ["in-app", "browser"] as const,
      "in-app",
    ),
    externalBrowser: oneOf(
      o.externalBrowser,
      ["default", "chrome", "firefox"] as const,
      "default",
    ),
    readerMode: typeof o.readerMode === "boolean" ? o.readerMode : false,
    haptics: typeof o.haptics === "boolean" ? o.haptics : true,
    swipe: coerceSwipe(o.swipe),
    filters: {
      keywords: asStringArray((o.filters as Record<string, unknown>)?.keywords),
      mutedCommunities: asStringArray(
        (o.filters as Record<string, unknown>)?.mutedCommunities,
      ) as JanusId[],
      mutedUsers: asStringArray(
        (o.filters as Record<string, unknown>)?.mutedUsers,
      ) as JanusId[],
    },
  };
}

export async function loadSettings(): Promise<JanusSettings> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return coerceSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: JanusSettings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(settings));
}

/** Read, apply a shallow patch, persist, and return the merged settings. */
export async function updateSettings(
  patch: Partial<JanusSettings>,
): Promise<JanusSettings> {
  const current = await loadSettings();
  const next = coerceSettings({ ...current, ...patch });
  await saveSettings(next);
  return next;
}
