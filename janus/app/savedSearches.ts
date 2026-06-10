import * as SecureStore from "expo-secure-store";

/**
 * Saved searches ("watches") — a pinned query the app re-runs so you can see
 * what's NEW since you last looked. The power-reader feature for fast-moving,
 * time-sensitive communities (r/churning datapoints, deal subs, award space):
 * the answer scrolls past in Hot, but a watch surfaces it the moment it posts.
 *
 * Local and account-free, like every other power-pack store. Each watch keeps
 * a bounded ring of result ids it has already shown you, so "3 new" is a real
 * diff, not a guess. Cross-network by construction: a watch fans out over
 * whichever sources its scope covers (Reddit + Lemmy), keyed by JanusIds.
 *
 * No server, no push — watches refresh when you open the Watches screen, the
 * same in-app polling model as live threads.
 */

const KEY = "janus.savedSearches.v1";
const CAP = 60; // max watches
const SEEN_CAP = 300; // ids remembered per watch

export type WatchSource = "all" | "reddit" | "lemmy";
/**
 * "posts" watches a search across communities; "comments" watches a keyword
 * INSIDE a thread series (r/churning's daily megathread, where the real
 * datapoints live in comments, not post titles) and follows the series as it
 * rotates day to day.
 */
export type WatchKind = "posts" | "comments";

export interface SavedSearch {
  /** Stable id (see {@link watchId}). */
  id: string;
  kind: WatchKind;
  query: string;
  source: WatchSource;
  /** Scope to one community (its JanusId), or omit for a cross-community watch. */
  communityId?: string;
  communityHandle?: string;
  createdAt: number;
  /** When you last opened this watch's results (the "new since" baseline). */
  lastCheckedAt: number;
  /** Result ids already shown to you (bounded ring). */
  seenIds: string[];
  // --- comment watches only -------------------------------------------------
  /** Normalized recurring-thread key, so the watch follows new editions. */
  seriesKey?: string;
  /** Human label used to find the newest edition by search. */
  seriesLabel?: string;
  /** The thread the watch was created from (fallback if the series search misses). */
  postId?: string;
}

export interface NewWatch {
  kind?: WatchKind;
  query: string;
  source: WatchSource;
  communityId?: string;
  communityHandle?: string;
  seriesKey?: string;
  seriesLabel?: string;
  postId?: string;
}

const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

export function watchId(
  query: string,
  source: WatchSource,
  communityId?: string,
  kind: WatchKind = "posts",
  seriesKey?: string,
): string {
  return kind === "comments"
    ? `comments|${communityId ?? ""}|${seriesKey ?? ""}|${norm(query)}`
    : `posts|${source}|${communityId ?? ""}|${norm(query)}`;
}

let cache: Map<string, SavedSearch> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Load watches into memory once. Safe to call repeatedly. */
export async function initSavedSearches(): Promise<void> {
  if (cache) return;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const entries: SavedSearch[] = Array.isArray(parsed)
      ? parsed.filter(
          (s): s is SavedSearch =>
            !!s && typeof s.id === "string" && typeof s.query === "string",
        )
      : [];
    cache = new Map(
      entries.map((s) => [
        s.id,
        { ...s, kind: s.kind ?? "posts", seenIds: s.seenIds ?? [] },
      ]),
    );
  } catch {
    cache = new Map();
  }
}

/** Newest first. */
export function listSavedSearches(): SavedSearch[] {
  if (!cache) return [];
  return [...cache.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function watchCount(): number {
  return cache?.size ?? 0;
}

export function isWatched(
  query: string,
  source: WatchSource,
  communityId?: string,
  kind: WatchKind = "posts",
  seriesKey?: string,
): boolean {
  return (
    cache?.has(watchId(query, source, communityId, kind, seriesKey)) ?? false
  );
}

export function getSearch(id: string): SavedSearch | undefined {
  return cache?.get(id);
}

/** Create a watch (or return the existing one for the same query+scope). */
export function addSearch(w: NewWatch, now: number = Date.now()): SavedSearch {
  if (!cache) cache = new Map();
  const kind = w.kind ?? "posts";
  const id = watchId(w.query, w.source, w.communityId, kind, w.seriesKey);
  const existing = cache.get(id);
  if (existing) return existing;
  const entry: SavedSearch = {
    id,
    kind,
    query: w.query.trim(),
    source: w.source,
    communityId: w.communityId,
    communityHandle: w.communityHandle,
    createdAt: now,
    // Treat everything that exists at creation as "already seen", so a brand-new
    // watch doesn't immediately claim dozens of results are new.
    lastCheckedAt: now,
    seenIds: [],
    seriesKey: w.seriesKey,
    seriesLabel: w.seriesLabel,
    postId: w.postId,
  };
  cache.set(id, entry);
  if (cache.size > CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  schedulePersist();
  return entry;
}

export function removeSearch(id: string): void {
  cache?.delete(id);
  schedulePersist();
}

/** Toggle a watch for a query+scope; returns true if it now exists. */
export function toggleSearch(w: NewWatch, now: number = Date.now()): boolean {
  const id = watchId(w.query, w.source, w.communityId, w.kind ?? "posts", w.seriesKey);
  if (cache?.has(id)) {
    removeSearch(id);
    return false;
  }
  addSearch(w, now);
  return true;
}

/**
 * Mark a watch as checked: fold the current result ids into its seen ring and
 * stamp lastCheckedAt. Call this when its results are shown.
 */
export function markChecked(
  id: string,
  resultIds: string[],
  now: number = Date.now(),
): void {
  const entry = cache?.get(id);
  if (!entry) return;
  const merged = [...entry.seenIds, ...resultIds.filter((r) => !entry.seenIds.includes(r))];
  entry.seenIds =
    merged.length > SEEN_CAP ? merged.slice(merged.length - SEEN_CAP) : merged;
  entry.lastCheckedAt = now;
  schedulePersist();
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushSavedSearches();
  }, 1500);
}

/** Persist now (also used by tests to assert the written value). */
export async function flushSavedSearches(): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      KEY,
      JSON.stringify([...(cache?.values() ?? [])]),
    );
  } catch {
    /* non-fatal */
  }
}

/** Test-only: drop in-memory state so each test starts clean. */
export function __resetSavedSearches(): void {
  cache = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
