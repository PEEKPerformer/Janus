import * as SecureStore from "expo-secure-store";

/**
 * RES-style user tags — a local label + color pinned to a username, shown
 * wherever that user appears. The classic power-user memory aid ("GPU expert",
 * "always wrong about batteries"), never sent anywhere.
 *
 * Keys are full unified handles ("u/name" or "name@instance", lowercased), so
 * tags are cross-network for free: a Reddit account and a Lemmy account each
 * carry their own tag, and the same tag UI works on both.
 */

const KEY = "janus.userTags.v1";
const CAP = 1000;

export interface UserTag {
  label: string;
  /** One of TAG_COLORS (hex). */
  color: string;
}

/** The fixed palette the editor offers — readable on light and dark cards. */
export const TAG_COLORS = [
  "#8b7cff", // lavender (brand)
  "#ff6a3d", // ember
  "#18d6a6", // mint
  "#3d9bff", // sky
  "#f9ca24", // gold
  "#e84393", // rose
] as const;

let cache: Map<string, UserTag> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const norm = (handle: string) => handle.trim().toLowerCase();

/** Load tags into memory once. Safe to call repeatedly. */
export async function initUserTags(): Promise<void> {
  if (cache) return;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = new Map(
      parsed && typeof parsed === "object"
        ? Object.entries(parsed as Record<string, UserTag>).filter(
            ([, v]) => !!v && typeof v.label === "string",
          )
        : [],
    );
  } catch {
    cache = new Map();
  }
}

/** Synchronous — only meaningful after {@link initUserTags} resolves. */
export function getUserTag(handle: string): UserTag | undefined {
  return cache?.get(norm(handle));
}

/** Set (or clear, with an empty label) the tag for a handle. */
export function setUserTag(handle: string, tag: UserTag): void {
  if (!cache) cache = new Map();
  const key = norm(handle);
  if (!tag.label.trim()) {
    cache.delete(key);
  } else {
    // Re-insert so Map order tracks recency (eviction drops the oldest).
    cache.delete(key);
    cache.set(key, { label: tag.label.trim().slice(0, 40), color: tag.color });
    if (cache.size > CAP) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  schedulePersist();
}

export function removeUserTag(handle: string): void {
  cache?.delete(norm(handle));
  schedulePersist();
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushUserTags();
  }, 1500);
}

/** Persist now (also used by tests to assert the written value). */
export async function flushUserTags(): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      KEY,
      JSON.stringify(Object.fromEntries(cache ?? new Map())),
    );
  } catch {
    /* non-fatal */
  }
}

/** Test-only: drop in-memory state so each test starts clean. */
export function __resetUserTags(): void {
  cache = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
