import { createMMKV } from "react-native-mmkv";

/**
 * A tiny stale-while-revalidate disk cache, modeled on the emoji cache: MMKV
 * (synchronous, no SecureStore size limit) keyed by an arbitrary string, with a
 * timestamp so callers can tell fresh from stale. The point is launch latency —
 * slow-changing, list-shaped network data (subscriptions, a community's about,
 * a profile) can paint instantly from disk while a background refetch reconciles
 * additions/removals. Never throws: a miss or parse error just returns null and
 * the caller falls back to the network.
 *
 * Deliberately NOT for feeds — those should stay fresh.
 */

interface Entry<T> {
  ts: number;
  value: T;
}

export interface CacheRead<T> {
  value: T;
  ageMs: number;
  /** Within the caller's TTL — safe to skip a blocking refetch. */
  fresh: boolean;
}

export interface SwrCache {
  read<T>(key: string, now: number, ttlMs: number): CacheRead<T> | null;
  write<T>(key: string, value: T, now: number): void;
  remove(key: string): void;
}

export function createSwrCache(id: string): SwrCache {
  const store = createMMKV({ id });
  return {
    read<T>(key: string, now: number, ttlMs: number): CacheRead<T> | null {
      try {
        const raw = store.getString(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Entry<T>;
        if (!parsed || typeof parsed.ts !== "number") return null;
        const ageMs = now - parsed.ts;
        return { value: parsed.value, ageMs, fresh: ageMs <= ttlMs };
      } catch {
        return null;
      }
    },
    write<T>(key: string, value: T, now: number): void {
      try {
        store.set(key, JSON.stringify({ ts: now, value } satisfies Entry<T>));
      } catch {
        /* best-effort */
      }
    },
    remove(key: string): void {
      try {
        store.remove(key);
      } catch {
        /* best-effort */
      }
    },
  };
}
