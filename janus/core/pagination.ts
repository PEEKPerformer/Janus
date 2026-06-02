/**
 * One pagination contract spanning Reddit's opaque `after` fullname and Lemmy's
 * PageCursor. We adopt the broadest shape (string | number, verified against
 * threadiverse's PageCursor) as an OPAQUE token the shell never inspects.
 *
 * `nextCursor === undefined` means "end of feed" (mirrors a falsy Lemmy
 * next_page and a null Reddit after).
 */

export type PageCursor = string | number;

export interface Page<T> {
  items: T[];
  nextCursor?: PageCursor;
}

export interface PageRequest {
  cursor?: PageCursor;
  /** Items per page. Adapters clamp to source limits (Reddit 100, Lemmy 50). */
  limit?: number;
  /** Cancellation, honoring Voyager's AbortController feed contract. */
  signal?: AbortSignal;
}

export function emptyPage<T>(): Page<T> {
  return { items: [] };
}
