import { createSwrCache, type SwrCache } from "./swrCache";

/**
 * The comments disk cache, shared between its two writers: PostScreen (every
 * thread you open writes through) and the plane-mode packer (bulk-warms it
 * before a flight). Keeping the store id AND the key format in one place is
 * what guarantees a packed thread is found by the exact read PostScreen does.
 */
export const COMMENTS_CACHE: SwrCache = createSwrCache("janus.comments.v1");
export const COMMENTS_TTL_MS = 120_000;

/** Cached value is the `Page<Comment>` exactly as the adapter returned it. */
export function commentsCacheKey(
  source: string,
  postId: string,
  sort: string,
): string {
  return `${source}:${postId}:${sort}`;
}
