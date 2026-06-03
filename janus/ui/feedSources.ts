/**
 * Maps a unified feed "mode" onto each source's native listing, and builds the
 * {@link FeedSourceSpec} list an aggregate feed fans out over.
 *
 * The three modes reconcile Reddit and Lemmy vocabularies into one switch:
 *  - subscribed → Reddit "home"     + Lemmy "Subscribed"  (your communities)
 *  - all        → Reddit "popular"  + Lemmy "All"         (the broad/federated firehose)
 *  - local      → (Reddit: n/a)     + Lemmy "Local"       (posts native to the instance)
 *
 * "Local" is a Lemmy-only concept, so Reddit is simply absent from a Local view
 * rather than faked.
 */
import { adapterKey } from "../app/AccountManager";
import type { SourceAdapter } from "../core/adapter";
import type { SourceKind } from "../core/ids";
import type { TimeWindow } from "../core/capabilities";
import type { FeedSourceSpec } from "./unifiedFeed";

export type FeedMode = "subscribed" | "all" | "local";

/** The native listingType for a source in a given mode, or null if N/A. */
export function listingFor(source: SourceKind, mode: FeedMode): string | null {
  if (source === "reddit") {
    if (mode === "subscribed") return "home";
    if (mode === "all") return "popular";
    return null; // Reddit has no "local"
  }
  // lemmy
  if (mode === "subscribed") return "Subscribed";
  if (mode === "local") return "Local";
  return "All";
}

export function buildAggregateSpecs(
  adapters: SourceAdapter[],
  mode: FeedMode,
  opts: { sort?: string; timeWindow?: TimeWindow },
): FeedSourceSpec[] {
  const specs: FeedSourceSpec[] = [];
  for (const adapter of adapters) {
    const listingType = listingFor(adapter.source, mode);
    if (!listingType) continue;
    specs.push({
      key: adapterKey(adapter.source, adapter.instance),
      adapter,
      query: { listingType, sort: opts.sort, timeWindow: opts.timeWindow },
    });
  }
  return specs;
}
