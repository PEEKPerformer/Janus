import type { Community, CommunityRef } from "../core/model";
import type { SourceAdapter } from "../core/adapter";
import { parseId, type JanusId, type SourceKind } from "../core/ids";

/**
 * Resolve the lightweight CommunityRef carried on every post into the full
 * Community the feed pin needs (capabilities, subscription state, sidebar
 * fields). One getCommunity call, routed to whichever adapter owns the id —
 * tapping "r/churning" on a card works the same as tapping a Lemmy handle.
 */
export async function resolveCommunityRef(
  adapterForEntity: (e: {
    source: SourceKind;
    instance: string;
  }) => SourceAdapter,
  ref: CommunityRef,
): Promise<Community | null> {
  try {
    const parts = parseId(ref.id as JanusId);
    const adapter = adapterForEntity({
      source: parts.source as SourceKind,
      instance: parts.instance,
    });
    return await adapter.getCommunity(ref.id as JanusId);
  } catch {
    return null;
  }
}
