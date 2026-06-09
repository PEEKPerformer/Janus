import * as SecureStore from "expo-secure-store";

/**
 * Read Later — a local, account-free bookmark queue. Server-side "saved"
 * requires being signed in to that network; this works for everyone, on both
 * networks at once, and never leaves the device.
 *
 * Entries are small snapshots (title/community/source) keyed by JanusId, like
 * threadVisits — opening one refetches the live post through whichever
 * adapter owns it. Loaded once into memory; reads are synchronous.
 */

const KEY = "janus.readLater.v1";
const CAP = 300;

export interface ReadLaterEntry {
  /** Post JanusId. */
  id: string;
  title: string;
  community: string;
  source: string;
  commentCount: number;
  addedAt: number;
}

/** What a post needs to provide to be queued. */
export interface QueueablePost {
  id: string;
  title: string;
  community: { handle: string };
  source: string;
  commentCount: number;
}

let cache: Map<string, ReadLaterEntry> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Load the queue into memory once. Safe to call repeatedly. */
export async function initReadLater(): Promise<void> {
  if (cache) return;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const entries: ReadLaterEntry[] = Array.isArray(parsed)
      ? parsed.filter(
          (e): e is ReadLaterEntry =>
            !!e && typeof e.id === "string" && typeof e.addedAt === "number",
        )
      : [];
    cache = new Map(entries.map((e) => [e.id, e]));
  } catch {
    cache = new Map();
  }
}

/** Synchronous — only meaningful after {@link initReadLater} resolves. */
export function isReadLater(id: string): boolean {
  return cache?.has(id) ?? false;
}

export function addReadLater(
  post: QueueablePost,
  now: number = Date.now(),
): void {
  if (!cache) cache = new Map();
  cache.delete(post.id); // re-adding bumps recency
  cache.set(post.id, {
    id: post.id,
    title: post.title,
    community: post.community.handle,
    source: post.source,
    commentCount: post.commentCount,
    addedAt: now,
  });
  if (cache.size > CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  schedulePersist();
}

export function removeReadLater(id: string): void {
  cache?.delete(id);
  schedulePersist();
}

/** Toggle membership; returns the new state (true = now queued). */
export function toggleReadLater(
  post: QueueablePost,
  now: number = Date.now(),
): boolean {
  if (isReadLater(post.id)) {
    removeReadLater(post.id);
    return false;
  }
  addReadLater(post, now);
  return true;
}

/** Newest first. */
export function listReadLater(): ReadLaterEntry[] {
  if (!cache) return [];
  return [...cache.values()].sort((a, b) => b.addedAt - a.addedAt);
}

export function readLaterCount(): number {
  return cache?.size ?? 0;
}

export function clearReadLater(): void {
  cache = new Map();
  schedulePersist();
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushReadLater();
  }, 1500);
}

/** Persist now (also used by tests to assert the written value). */
export async function flushReadLater(): Promise<void> {
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
export function __resetReadLater(): void {
  cache = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
