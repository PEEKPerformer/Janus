import * as SecureStore from "expo-secure-store";

/**
 * "Seen" post tracking for the optional hide-seen-posts feature. A bounded,
 * on-device ring of post ids you've opened. Source-agnostic (JanusIds), and kept
 * in memory after first load so the feed filter can ask {@link isSeen}
 * synchronously while it renders.
 */

const KEY = "janus.seenPosts.v1";
const CAP = 3000;

let cache: Set<string> | null = null;
let order: string[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Load the seen set into memory once. Safe to call repeatedly. */
export async function initSeenPosts(): Promise<void> {
  if (cache) return;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    order = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    order = [];
  }
  cache = new Set(order);
}

/** Synchronous — only meaningful after {@link initSeenPosts} resolves. */
export function isSeen(id: string): boolean {
  return cache?.has(id) ?? false;
}

export function markSeen(id: string): void {
  if (!cache) cache = new Set();
  if (cache.has(id)) return;
  cache.add(id);
  order.push(id);
  if (order.length > CAP) {
    const overflow = order.length - CAP;
    for (const dropped of order.splice(0, overflow)) cache.delete(dropped);
  }
  schedulePersist();
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushSeen();
  }, 1500);
}

/** Persist now (also used by tests to assert the written value). */
export async function flushSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(order));
  } catch {
    /* non-fatal */
  }
}

/** Test-only: drop in-memory state so each test starts clean. */
export function __resetSeenPosts(): void {
  cache = null;
  order = [];
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
