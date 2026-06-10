import { getCommunitySort } from "./communityPrefs";

/**
 * Comment-sort resolution, shared between PostScreen and the plane-mode
 * packer. The comments cache key embeds the sort, so the packer must land on
 * the SAME sort PostScreen will resolve when the thread is opened offline —
 * any drift and the packed entry is invisible. Extracted so there is exactly
 * one definition of "which sort does a thread open with".
 */

/**
 * The sync half: match the user's unified preference against this adapter's
 * sort options case-insensitively (Lemmy ids are PascalCase, Reddit
 * lowercase), falling back to the adapter's first option.
 */
export function defaultCommentSortFor(
  sorts: readonly { id: string }[],
  preferred: string,
): string {
  return (
    sorts.find((s) => s.id.toLowerCase() === preferred.toLowerCase())?.id ??
    sorts[0]?.id ??
    ""
  );
}

/**
 * Full resolution, including the per-community sort memory (when that setting
 * is on) — the sort whose cache key PostScreen will actually read.
 */
export async function resolveCommentSort(opts: {
  sorts: readonly { id: string }[];
  preferred: string;
  communityId: string;
  rememberCommunitySort: boolean;
}): Promise<string> {
  const fallback = defaultCommentSortFor(opts.sorts, opts.preferred);
  if (!opts.rememberCommunitySort) return fallback;
  try {
    const saved = await getCommunitySort(opts.communityId, "comment");
    if (saved && opts.sorts.some((s) => s.id === saved)) return saved;
  } catch {
    /* fall through */
  }
  return fallback;
}
