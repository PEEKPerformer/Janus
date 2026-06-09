import * as SecureStore from "expo-secure-store";

/**
 * Per-community remembered sort. Source-agnostic: a key is any community's
 * JanusId, so a subreddit and a Lemmy community remember their last post/comment
 * sort the same way. Gated behind settings.rememberCommunitySort at the call site.
 */

const KEY = "janus.communitySort.v1";
const CAP = 300; // bound the store

export type CommunitySortKind = "post" | "comment";
type Entry = { post?: string; comment?: string };
type Store = Record<string, Entry>;

async function load(): Promise<Store> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

async function save(store: Store): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(store));
  } catch {
    /* non-fatal */
  }
}

export async function getCommunitySort(
  communityId: string,
  kind: CommunitySortKind,
): Promise<string | undefined> {
  const store = await load();
  return store[communityId]?.[kind];
}

export async function setCommunitySort(
  communityId: string,
  kind: CommunitySortKind,
  sort: string,
): Promise<void> {
  const store = await load();
  store[communityId] = { ...store[communityId], [kind]: sort };
  // Evict the oldest-inserted keys if we exceed the cap (insertion order).
  const keys = Object.keys(store);
  if (keys.length > CAP) {
    for (const k of keys.slice(0, keys.length - CAP)) delete store[k];
  }
  await save(store);
}
