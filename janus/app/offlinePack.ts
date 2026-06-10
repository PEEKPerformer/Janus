import { createMMKV } from "react-native-mmkv";
import type { Post } from "../core/model";
import type { Page, PageRequest } from "../core/pagination";

/**
 * The plane-mode pack manifest — what's onboard. The pack itself lives in the
 * stores the app already reads (comments in the shared SWR cache, image bytes
 * in expo-image's disk cache); this records WHICH threads were packed, their
 * per-item status, and a full Post snapshot per thread so a packed thread can
 * be opened with zero network (`navigate("Post", { post })` needs the object).
 *
 * MMKV (not SecureStore): nothing here is secret, snapshots are too big for
 * the keychain, and synchronous reads mean no init step.
 */

const store = createMMKV({ id: "janus.offlinePack.v1" });
const MANIFEST_KEY = "manifest";

export type PackOrigin = "readLater" | "series" | "community" | "feed";
/** packed = comments + images landed; partial = some piece failed; failed = post itself unreachable. */
export type PackStatus = "packed" | "partial" | "failed";

export interface PackedItem {
  /** Post JanusId. */
  id: string;
  title: string;
  community: string;
  source: string;
  commentCount: number;
  origin: PackOrigin;
  status: PackStatus;
}

export interface PackManifest {
  packedAt: number;
  items: PackedItem[];
}

function readManifest(): PackManifest | null {
  try {
    const raw = store.getString(MANIFEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PackManifest;
    if (!parsed || typeof parsed.packedAt !== "number") return null;
    return {
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return null;
  }
}

function writeManifest(m: PackManifest): void {
  try {
    store.set(MANIFEST_KEY, JSON.stringify(m));
  } catch {
    /* best-effort */
  }
}

export function getPackManifest(): PackManifest | null {
  return readManifest();
}

/** Start a fresh pack: drop the previous manifest and its post snapshots. */
export function beginPack(now: number): void {
  clearPack();
  writeManifest({ packedAt: now, items: [] });
}

/** Add or update one packed thread's manifest row (keyed by post id). */
export function upsertPackedItem(item: PackedItem): void {
  const m = readManifest() ?? { packedAt: 0, items: [] };
  const items = m.items.filter((i) => i.id !== item.id);
  items.push(item);
  writeManifest({ ...m, items });
}

/** Store the full Post so a packed thread opens with zero network. */
export function savePackedPost(post: Post): void {
  try {
    store.set(`post:${post.id}`, JSON.stringify(post));
  } catch {
    /* best-effort */
  }
}

export function getPackedPost(id: string): Post | null {
  try {
    const raw = store.getString(`post:${id}`);
    return raw ? (JSON.parse(raw) as Post) : null;
  } catch {
    return null;
  }
}

/** Manifest rows, pack order preserved (read-later first, then series, feed). */
export function listPackedItems(): PackedItem[] {
  return readManifest()?.items ?? [];
}

/** Threads actually readable offline (failed rows don't count). */
export function packedCount(): number {
  return listPackedItems().filter((i) => i.status !== "failed").length;
}

export function clearPack(): void {
  const m = readManifest();
  if (m) for (const i of m.items) store.remove(`post:${i.id}`);
  store.remove(MANIFEST_KEY);
}

/**
 * The pack served as a normal cursor-paginated feed, so offline browsing is
 * first-class: the SAME FeedScreen, PostCards, gallery mode and repost
 * collapse — just fed from disk. Pack order is preserved (read-later first,
 * then series, communities, feed snapshot); `communityId` scopes it when a
 * community is pinned. The cursor is simply the next offset.
 */
export function packedFeedPage(
  req: PageRequest,
  communityId?: string,
): Page<Post> {
  const posts = listPackedItems()
    .filter((i) => i.status !== "failed")
    .map((i) => getPackedPost(i.id))
    .filter((p): p is Post => !!p)
    .filter((p) => !communityId || p.community.id === communityId);
  const start =
    typeof req.cursor === "number" ? req.cursor : Number(req.cursor ?? 0);
  const limit = req.limit ?? 25;
  const items = posts.slice(start, start + limit);
  const end = start + limit;
  return { items, nextCursor: end < posts.length ? end : undefined };
}
