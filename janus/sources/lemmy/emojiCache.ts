import { createMMKV } from "react-native-mmkv";
import type { CustomEmoji } from "../../core/model";

/**
 * Disk cache for an instance's custom-emoji list so a cold start skips the
 * /site round-trip (hexbear ships ~2,700 emoji). Keyed by instance, with a TTL
 * so newly-added emoji still appear within a day. MMKV (already a dep) handles
 * the ~hundreds-of-KB blob fine, unlike size-limited SecureStore. Never throws —
 * a cache miss just falls back to the network.
 */
const store = createMMKV({ id: "janus.emoji.v1" });
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const key = (instance: string) => `emoji:${instance.toLowerCase()}`;

export function readEmojiCache(
  instance: string,
  now: number,
): CustomEmoji[] | null {
  try {
    const raw = store.getString(key(instance));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; emojis: CustomEmoji[] };
    if (!parsed?.ts || now - parsed.ts > TTL_MS) return null;
    return Array.isArray(parsed.emojis) ? parsed.emojis : null;
  } catch {
    return null;
  }
}

export function writeEmojiCache(
  instance: string,
  emojis: CustomEmoji[],
  now: number,
): void {
  try {
    store.set(key(instance), JSON.stringify({ ts: now, emojis }));
  } catch {
    /* best-effort cache; ignore failures */
  }
}
