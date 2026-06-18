import { createMMKV } from "react-native-mmkv";

/**
 * Plane-mode pack preferences — the user's chosen extent and contexts for the
 * scrape, persisted so the pack button always does what they set up once:
 * which contexts (Read Later / followed series / feed snapshot / specific
 * communities), and how much of each (snapshot size, posts per community,
 * whether images come along). MMKV: synchronous, no init step.
 */

const store = createMMKV({ id: "janus.packPrefs.v1" });
const KEY = "prefs";
const COMMUNITY_CAP = 12;

export interface PackCommunity {
  /** Community JanusId. */
  id: string;
  handle: string;
  source: string;
}

/**
 * When Janus re-packs on its own. "off" = only the manual button. "onOpen" =
 * silently re-pack when you open Plane Mode and the pack has gone stale. (A
 * future "background" tier adds opportunistic iOS background top-ups.)
 */
export type PackAutoRefresh = "off" | "onOpen";

export interface PackPrefs {
  readLater: boolean;
  series: boolean;
  feedSnapshot: boolean;
  /** Posts per network in the home-feed snapshot. */
  feedLimit: number;
  /** Specific communities to pack, beyond the home feed. */
  communities: PackCommunity[];
  /** Posts packed per chosen community. */
  communityLimit: number;
  includeImages: boolean;
  /** Judge packed posts + top comments with AI Lens during the pack. */
  aiScan: boolean;
  /** Auto re-pack policy when the pack goes stale. */
  autoRefresh: PackAutoRefresh;
}

export const DEFAULT_PACK_PREFS: PackPrefs = {
  readLater: true,
  series: true,
  feedSnapshot: true,
  feedLimit: 50,
  communities: [],
  communityLimit: 25,
  includeImages: true,
  aiScan: false,
  autoRefresh: "onOpen",
};

export function getPackPrefs(): PackPrefs {
  try {
    const raw = store.getString(KEY);
    if (!raw) return { ...DEFAULT_PACK_PREFS };
    const parsed = JSON.parse(raw) as Partial<PackPrefs>;
    return {
      ...DEFAULT_PACK_PREFS,
      ...parsed,
      communities: Array.isArray(parsed.communities) ? parsed.communities : [],
      autoRefresh:
        parsed.autoRefresh === "off" || parsed.autoRefresh === "onOpen"
          ? parsed.autoRefresh
          : DEFAULT_PACK_PREFS.autoRefresh,
    };
  } catch {
    return { ...DEFAULT_PACK_PREFS };
  }
}

export function setPackPrefs(patch: Partial<PackPrefs>): PackPrefs {
  const next = { ...getPackPrefs(), ...patch };
  next.communities = next.communities.slice(0, COMMUNITY_CAP);
  try {
    store.set(KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
  return next;
}

/** Toggle a community in the pack list; returns the new prefs. */
export function togglePackCommunity(c: PackCommunity): PackPrefs {
  const prefs = getPackPrefs();
  const has = prefs.communities.some((x) => x.id === c.id);
  return setPackPrefs({
    communities: has
      ? prefs.communities.filter((x) => x.id !== c.id)
      : [...prefs.communities, c],
  });
}
