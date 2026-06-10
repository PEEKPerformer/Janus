import * as SecureStore from "expo-secure-store";

/**
 * Saved-post categories — RES-style organization layered over both networks'
 * saved content. Reddit and Lemmy each keep a flat "saved" list server-side;
 * this local overlay files any saved item (post or comment, either network —
 * keys are JanusIds) into a named category, so "Recipes", "Buildapc parts",
 * "Churning datapoints" stop being one undifferentiated pile.
 */

const KEY = "janus.savedCategories.v1";
const CAP = 2000;

let cache: Map<string, string> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Load assignments into memory once. Safe to call repeatedly. */
export async function initSavedCategories(): Promise<void> {
  if (cache) return;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = new Map(
      parsed && typeof parsed === "object"
        ? Object.entries(parsed as Record<string, string>).filter(
            ([, v]) => typeof v === "string" && v.length > 0,
          )
        : [],
    );
  } catch {
    cache = new Map();
  }
}

/** Synchronous — only meaningful after {@link initSavedCategories} resolves. */
export function getCategory(id: string): string | undefined {
  return cache?.get(id);
}

/** Assign (or clear, with null/empty) the category for a saved item. */
export function setCategory(id: string, category: string | null): void {
  if (!cache) cache = new Map();
  const name = category?.trim().slice(0, 40);
  if (!name) {
    cache.delete(id);
  } else {
    cache.delete(id); // re-insert so Map order tracks recency
    cache.set(id, name);
    if (cache.size > CAP) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  schedulePersist();
}

/** Distinct category names, alphabetical — drives the filter chips. */
export function listCategories(): string[] {
  if (!cache) return [];
  return [...new Set(cache.values())].sort((a, b) => a.localeCompare(b));
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushSavedCategories();
  }, 1500);
}

/** Persist now (also used by tests to assert the written value). */
export async function flushSavedCategories(): Promise<void> {
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
export function __resetSavedCategories(): void {
  cache = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
