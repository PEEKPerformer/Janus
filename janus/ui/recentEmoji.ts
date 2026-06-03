import * as SecureStore from "expo-secure-store";

/**
 * Per-instance "recently used" emoji, remembered on-device so the picker can
 * surface what *you* actually reach for (custom emoji are instance-scoped, so
 * the list is keyed by instance). Most-recent-first, deduped, capped.
 */
const CAP = 32;
const key = (instance: string) => `recentEmoji:${instance.toLowerCase()}`;

/** Pure: move `shortcode` to the front, dedupe, cap. Exported for testing. */
export function mergeRecent(
  list: string[],
  shortcode: string,
  cap = CAP,
): string[] {
  return [shortcode, ...list.filter((s) => s !== shortcode)].slice(0, cap);
}

export async function loadRecentEmoji(instance: string): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(key(instance));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((s) => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

export async function recordRecentEmoji(
  instance: string,
  shortcode: string,
): Promise<string[]> {
  const next = mergeRecent(await loadRecentEmoji(instance), shortcode);
  try {
    await SecureStore.setItemAsync(key(instance), JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
  return next;
}
