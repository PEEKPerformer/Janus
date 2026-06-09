import * as SecureStore from "expo-secure-store";
import type { SourceKind } from "../core/ids";

/**
 * Favorites — auto-ranked by usage, with manual pin/remove on top.
 *
 * Two layers, both source-agnostic (a favorite is a Reddit subreddit or a Lemmy
 * community on any instance, keyed by JanusId):
 *
 *  1. Auto: every time you open a community feed or a post, we bump an on-device
 *     counter (frequency) and stamp the time (recency). The drawer surfaces the
 *     top communities automatically, ranked by frequency × recency-decay so the
 *     list tracks your current habits and lets stale ones fade.
 *  2. Manual: you can PIN any community (it sticks to the top regardless of
 *     usage) and REMOVE one you don't want (it's hidden from the auto list).
 *
 * Everything is stored as community snapshots so rows render without re-fetching.
 */

export interface CommunityVisit {
  id: string; // JanusId
  source: SourceKind;
  instance: string;
  name: string;
  handle: string;
  icon?: string;
  count: number;
  lastTs: number;
}

/** A favorite as shown in the drawer — a visit snapshot plus whether it's pinned. */
export interface FavoriteEntry extends CommunityVisit {
  pinned: boolean;
}

export type VisitInput = Omit<CommunityVisit, "count" | "lastTs">;

const KEY = "janus.communityVisits.v1";
const PIN_KEY = "janus.pinnedCommunities.v1"; // manual pins (snapshots, newest first)
const HIDE_KEY = "janus.hiddenFavorites.v1"; // ids removed from the auto list
const CAP = 200; // keep the store bounded
const HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 7; // a week

/**
 * Rank visits by frequency decayed toward recency: score = count · 0.5^(age/half-life).
 * Pure (takes `now`) so it's deterministic in tests.
 */
export function rankVisits(
  visits: CommunityVisit[],
  now: number,
  limit = 8,
): CommunityVisit[] {
  return [...visits]
    .map((v) => ({
      v,
      score: v.count * Math.pow(0.5, (now - v.lastTs) / HALF_LIFE_MS),
    }))
    .sort((a, b) => b.score - a.score || b.v.lastTs - a.v.lastTs)
    .slice(0, limit)
    .map((x) => x.v);
}

function isVisit(v: unknown): v is CommunityVisit {
  return (
    !!v &&
    typeof (v as CommunityVisit).id === "string" &&
    typeof (v as CommunityVisit).count === "number"
  );
}

async function readVisits(key: string): Promise<CommunityVisit[]> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isVisit) : [];
  } catch {
    return [];
  }
}

async function writeVisits(key: string, list: CommunityVisit[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(list.slice(0, CAP)));
  } catch {
    /* non-fatal */
  }
}

const loadAll = () => readVisits(KEY);
const loadPins = () => readVisits(PIN_KEY);

async function readHidden(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(HIDE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

async function writeHidden(ids: string[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(HIDE_KEY, JSON.stringify(ids.slice(0, CAP)));
  } catch {
    /* non-fatal */
  }
}

/** Record one visit to a community, merging into the existing counter. */
export async function recordCommunityVisit(
  input: VisitInput,
  now: number,
): Promise<void> {
  const all = await loadAll();
  const existing = all.find((v) => v.id === input.id);
  const next: CommunityVisit = existing
    ? { ...existing, ...input, count: existing.count + 1, lastTs: now }
    : { ...input, count: 1, lastTs: now };
  const merged = [next, ...all.filter((v) => v.id !== input.id)];
  // Bound the store: keep the most-recently-touched CAP entries.
  const bounded = merged.sort((a, b) => b.lastTs - a.lastTs);
  await writeVisits(KEY, bounded);
}

/**
 * Manually pin a community to the top of favorites — it stays regardless of how
 * often it's used. Pinning a community you'd previously removed un-hides it.
 */
export async function pinCommunity(
  input: VisitInput,
  now: number,
): Promise<void> {
  const pins = await loadPins();
  const existing = pins.find((p) => p.id === input.id);
  const next: CommunityVisit = existing
    ? { ...existing, ...input }
    : { ...input, count: 0, lastTs: now };
  await writeVisits(PIN_KEY, [next, ...pins.filter((p) => p.id !== input.id)]);
  const hidden = await readHidden();
  if (hidden.includes(input.id)) {
    await writeHidden(hidden.filter((id) => id !== input.id));
  }
}

/** Drop a manual pin (the community may still appear via the auto list). */
export async function unpinCommunity(id: string): Promise<void> {
  const pins = await loadPins();
  if (pins.some((p) => p.id === id)) {
    await writeVisits(
      PIN_KEY,
      pins.filter((p) => p.id !== id),
    );
  }
}

/** Hide a community from the auto-ranked favorites. */
export async function hideFromFavorites(id: string): Promise<void> {
  const hidden = await readHidden();
  if (!hidden.includes(id)) await writeHidden([id, ...hidden]);
}

/**
 * Remove a community from favorites entirely — drops any manual pin AND hides it
 * from the auto list, so it disappears no matter how it got there. Re-pinning
 * brings it back.
 */
export async function removeFavorite(id: string): Promise<void> {
  await unpinCommunity(id);
  await hideFromFavorites(id);
}

/** True when a community is manually pinned. */
export async function isPinned(id: string): Promise<boolean> {
  return (await loadPins()).some((p) => p.id === id);
}

/**
 * The favorites list: manual pins first (in pin order), then the top auto-ranked
 * communities, excluding anything hidden or already pinned. `limit` bounds the
 * auto tail only — pins always all show.
 */
export async function loadFavorites(
  now: number,
  limit = 8,
): Promise<FavoriteEntry[]> {
  const [visits, pins, hidden] = await Promise.all([
    loadAll(),
    loadPins(),
    readHidden(),
  ]);
  const hiddenSet = new Set(hidden);
  const pinned: FavoriteEntry[] = pins
    .filter((p) => !hiddenSet.has(p.id))
    .map((p) => ({ ...p, pinned: true }));
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const auto: FavoriteEntry[] = rankVisits(
    visits.filter((v) => !hiddenSet.has(v.id) && !pinnedIds.has(v.id)),
    now,
    limit,
  ).map((v) => ({ ...v, pinned: false }));
  return [...pinned, ...auto];
}
