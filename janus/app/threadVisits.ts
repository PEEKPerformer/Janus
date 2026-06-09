import * as SecureStore from "expo-secure-store";

/**
 * Per-thread visit tracking — the store behind two power features:
 *
 *  1. **New-comment highlighting**: opening a post records when you were last
 *     there and how many comments it had; on a revisit, comments newer than
 *     that timestamp are marked NEW and the feed badges "+N" on the card.
 *  2. **History**: every visit keeps a tiny snapshot (title/community/source),
 *     so "what was that post from last night?" finally has an answer.
 *
 * Source-agnostic by construction: keys are JanusIds, so Reddit posts and
 * Lemmy posts (on any instance) track identically. Like seenPosts, the store
 * is loaded once into memory and read synchronously while lists render.
 */

const KEY = "janus.threadVisits.v1";
const CAP = 600;

export interface ThreadVisit {
  /** Post JanusId. */
  id: string;
  /** When the visit before the current one started — "new" compares to this. */
  lastVisit: number;
  /** Comment count at that visit — the feed's "+N new" baseline. */
  commentCount: number;
  /** Most recent open (history ordering). */
  visitedAt: number;
  // History snapshot:
  title: string;
  community: string;
  source: string;
}

/** What a post being opened needs to hand the store. */
export interface VisitablePost {
  id: string;
  commentCount: number;
  title: string;
  community: { handle: string };
  source: string;
}

let cache: Map<string, ThreadVisit> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Load visits into memory once. Safe to call repeatedly. */
export async function initThreadVisits(): Promise<void> {
  if (cache) return;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const entries: ThreadVisit[] = Array.isArray(parsed)
      ? parsed.filter(
          (v): v is ThreadVisit =>
            !!v && typeof v.id === "string" && typeof v.lastVisit === "number",
        )
      : [];
    cache = new Map(entries.map((v) => [v.id, v]));
  } catch {
    cache = new Map();
  }
}

/**
 * Peek at the stored visit without recording one — what the feed uses for the
 * "+N new" badge. Synchronous; undefined before init or on first encounter.
 */
export function getVisit(id: string): ThreadVisit | undefined {
  return cache?.get(id);
}

/**
 * Record that a post is being opened NOW, returning the **previous** visit
 * (the baseline new-comment highlighting compares against), or null on a
 * first visit. The stored entry's `lastVisit` becomes this open's time so the
 * next revisit compares against today, while `commentCount` is refreshed so
 * the feed badge resets.
 */
export function recordVisit(
  post: VisitablePost,
  now: number = Date.now(),
): ThreadVisit | null {
  if (!cache) cache = new Map();
  const prev = cache.get(post.id) ?? null;
  // Re-insert so Map order tracks recency (eviction drops the oldest).
  cache.delete(post.id);
  cache.set(post.id, {
    id: post.id,
    lastVisit: now,
    commentCount: post.commentCount,
    visitedAt: now,
    title: post.title,
    community: post.community.handle,
    source: post.source,
  });
  if (cache.size > CAP) {
    const overflow = cache.size - CAP;
    let i = 0;
    for (const k of cache.keys()) {
      if (i++ >= overflow) break;
      cache.delete(k);
    }
  }
  schedulePersist();
  return prev;
}

/** Most recent first — the History screen's data. */
export function listHistory(): ThreadVisit[] {
  if (!cache) return [];
  return [...cache.values()].sort((a, b) => b.visitedAt - a.visitedAt);
}

export function clearHistory(): void {
  cache = new Map();
  schedulePersist();
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushThreadVisits();
  }, 1500);
}

/** Persist now (also used by tests to assert the written value). */
export async function flushThreadVisits(): Promise<void> {
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
export function __resetThreadVisits(): void {
  cache = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
