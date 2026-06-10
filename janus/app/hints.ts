import { createMMKV } from "react-native-mmkv";
import { seriesKeyForTitle, seriesLabelForTitle } from "./threadSeries";
import type { ThreadVisit } from "./threadVisits";

/**
 * Just-in-time feature teaching. No tours, no modals, no tooltip storms — the
 * app notices a behavior pattern and names the relevant feature at the moment
 * it's useful, in a dismissible inline strip. This store remembers which
 * one-time hints were seen and which suggestions were waved off, so nothing
 * nags twice. MMKV: synchronous, no init step.
 */

const store = createMMKV({ id: "janus.hints.v1" });
const KEY = "state";

interface HintState {
  /** One-time hint ids already shown/dismissed (e.g. "feed.longPress"). */
  seen: string[];
  /** Series suggestions waved off, as `${communityId} ${seriesKey}`. */
  dismissedSeries: string[];
}

function load(): HintState {
  try {
    const raw = store.getString(KEY);
    const parsed = raw ? (JSON.parse(raw) as HintState) : null;
    return {
      seen: Array.isArray(parsed?.seen) ? parsed.seen : [],
      dismissedSeries: Array.isArray(parsed?.dismissedSeries)
        ? parsed.dismissedSeries
        : [],
    };
  } catch {
    return { seen: [], dismissedSeries: [] };
  }
}

function save(state: HintState): void {
  try {
    store.set(KEY, JSON.stringify(state));
  } catch {
    /* best-effort */
  }
}

export function hasSeenHint(id: string): boolean {
  return load().seen.includes(id);
}

export function markHintSeen(id: string): void {
  const state = load();
  if (state.seen.includes(id)) return;
  save({ ...state, seen: [...state.seen, id] });
}

const seriesId = (communityId: string, seriesKey: string) =>
  `${communityId} ${seriesKey}`;

export function isSeriesSuggestionDismissed(
  communityId: string,
  seriesKey: string,
): boolean {
  return load().dismissedSeries.includes(seriesId(communityId, seriesKey));
}

export function dismissSeriesSuggestion(
  communityId: string,
  seriesKey: string,
): void {
  const state = load();
  const id = seriesId(communityId, seriesKey);
  if (state.dismissedSeries.includes(id)) return;
  save({ ...state, dismissedSeries: [...state.dismissedSeries, id] });
}

// ---------------------------------------------------------------------------
// Series suggestions from reading habits
// ---------------------------------------------------------------------------

export interface SeriesSuggestion {
  communityId: string;
  communityHandle: string;
  source: string;
  seriesKey: string;
  label: string;
  /** A representative title (the newest visit's) — what followSeries needs. */
  sampleTitle: string;
  /** Distinct editions of this series you've opened. */
  editionsSeen: number;
}

/**
 * Detect megathread habits from browsing history: distinct thread visits in
 * the same community whose titles normalize to the same series key. You read
 * two editions of a daily without following it → that's the teaching moment.
 * Pure over its inputs; callers pass the followed/dismissed predicates.
 */
export function suggestSeriesFromHistory(
  history: readonly ThreadVisit[],
  opts: {
    isFollowed: (communityId: string, title: string) => boolean;
    minEditions?: number;
  },
): SeriesSuggestion[] {
  const minEditions = opts.minEditions ?? 2;
  const groups = new Map<
    string,
    { ids: Set<string>; newest: ThreadVisit; seriesKey: string }
  >();
  for (const v of history) {
    if (!v.communityId) continue; // pre-upgrade visit: can't act on it
    const key = seriesKeyForTitle(v.title);
    // Single-token keys ("rant") collide too easily to suggest from.
    if (!key || key.split(" ").length < 2) continue;
    const gk = seriesId(v.communityId, key);
    const g = groups.get(gk);
    if (g) {
      g.ids.add(v.id);
      if (v.visitedAt > g.newest.visitedAt) g.newest = v;
    } else {
      groups.set(gk, { ids: new Set([v.id]), newest: v, seriesKey: key });
    }
  }
  const out: SeriesSuggestion[] = [];
  for (const g of groups.values()) {
    const v = g.newest;
    if (g.ids.size < minEditions) continue;
    if (opts.isFollowed(v.communityId!, v.title)) continue;
    if (isSeriesSuggestionDismissed(v.communityId!, g.seriesKey)) continue;
    out.push({
      communityId: v.communityId!,
      communityHandle: v.community,
      source: v.source,
      seriesKey: g.seriesKey,
      label: seriesLabelForTitle(v.title),
      sampleTitle: v.title,
      editionsSeen: g.ids.size,
    });
  }
  return out.sort((a, b) => b.editionsSeen - a.editionsSeen);
}
