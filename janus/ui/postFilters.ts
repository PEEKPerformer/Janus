import type { Post } from "../core/model";
import type { PostFilters } from "../app/settingsStore";

/**
 * Client-side, source-agnostic feed filtering. Muting a community or user and
 * keyword filters all live here as ONE pure function applied to the merged
 * Reddit+Lemmy pool — so a muted community hides its posts whether they
 * surfaced from Reddit or any Lemmy instance, with identical semantics. This is
 * the unification payoff: no per-source filter forks.
 *
 * Server-side blocks (where an adapter supports them) are a separate concern;
 * this layer guarantees the post never reaches the list regardless.
 */

export interface FilterOptions {
  filters: PostFilters;
  hideNsfw: boolean;
}

/** Text a keyword filter is matched against: title + plain body. */
function postText(post: Post): string {
  return `${post.title}\n${post.body.text ?? post.body.markdown ?? ""}`.toLowerCase();
}

/** True if the post should be HIDDEN under the given filters. */
export function isFiltered(post: Post, opts: FilterOptions): boolean {
  const { filters, hideNsfw } = opts;
  if (hideNsfw && post.isNSFW) return true;
  if (filters.mutedCommunities.includes(post.community.id)) return true;
  if (filters.mutedUsers.includes(post.author.id)) return true;
  if (filters.keywords.length) {
    const haystack = postText(post);
    const needles = filters.keywords
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (needles.some((n) => haystack.includes(n))) return true;
  }
  return false;
}

/** Drop every filtered post from a list, preserving order. */
export function filterPosts(posts: Post[], opts: FilterOptions): Post[] {
  return posts.filter((p) => !isFiltered(p, opts));
}
