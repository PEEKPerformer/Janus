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

export interface JanusSettings {
  // Appearance
  postLayout: PostLayout;
  appearance: Appearance;
  fontScale: number;
  blurNsfw: boolean;
  // Feed behaviour
  defaultFeed: FeedMode;
  defaultPostSort: string;
  topTimeWindow: TimeWindow;
  defaultCommentSort: string;
  hideNsfw: boolean;
  // General
  linkHandling: LinkHandling;
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
  fontScale: 1,
  blurNsfw: true,
  defaultFeed: "subscribed",
  defaultPostSort: "hot",
  topTimeWindow: "day",
  defaultCommentSort: "top",
  hideNsfw: false,
  linkHandling: "in-app",
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
    fontScale: clampFont(o.fontScale),
    blurNsfw: typeof o.blurNsfw === "boolean" ? o.blurNsfw : true,
    defaultFeed: oneOf(
      o.defaultFeed,
      ["subscribed", "all", "local"] as const,
      "subscribed",
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
    linkHandling: oneOf(
      o.linkHandling,
      ["in-app", "browser"] as const,
      "in-app",
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
