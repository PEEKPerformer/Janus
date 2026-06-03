import * as SecureStore from "expo-secure-store";
import type { SourceKind } from "../core/ids";

/**
 * Auto-favorites — pays attention to which communities you actually use.
 *
 * Every time you open a community feed or a post, we bump an on-device counter
 * for that community (frequency) and stamp the time (recency). The drawer then
 * surfaces the top communities automatically — no manual favouriting — ranked by
 * a frequency × recency-decay score so the list tracks your current habits and
 * lets stale ones fade. Stored as snapshots so rows render without re-fetching.
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

export type VisitInput = Omit<CommunityVisit, "count" | "lastTs">;

const KEY = "janus.communityVisits.v1";
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

async function loadAll(): Promise<CommunityVisit[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (v): v is CommunityVisit =>
            !!v && typeof v.id === "string" && typeof v.count === "number",
        )
      : [];
  } catch {
    return [];
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
  const bounded = merged.sort((a, b) => b.lastTs - a.lastTs).slice(0, CAP);
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(bounded));
  } catch {
    /* non-fatal */
  }
}

export async function loadFavorites(
  now: number,
  limit = 8,
): Promise<CommunityVisit[]> {
  return rankVisits(await loadAll(), now, limit);
}
