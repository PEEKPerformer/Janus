/**
 * Group feed — fans a cross-source {@link FeedGroup} out into the same N-way
 * aggregate feed everything else uses. Each member is resolved to a concrete
 * community on its OWN instance, then merged round-robin.
 *
 * Reddit communities resolve offline (the subreddit name IS the routing id).
 * Lemmy needs a real numeric id, so we resolve `https://instance/c/name` through
 * that instance's adapter (federation-aware). Resolution is cached in the
 * fetcher closure so it happens once per feed, not once per page; a member that
 * fails to resolve (instance down, gone) is simply dropped, never fatal.
 */
import { buildId } from "../core/ids";
import type { AccountManager } from "../app/AccountManager";
import type { CommunityAddress } from "../app/feedGroups";
import { createAggregateFeed, type FeedSourceSpec } from "./unifiedFeed";
import type { Post } from "../core/model";
import type { Page, PageRequest } from "../core/pagination";
import type { TimeWindow } from "../core/capabilities";

interface GroupOpts {
  sort?: string;
  timeWindow?: TimeWindow;
}

async function resolveMember(
  manager: AccountManager,
  m: CommunityAddress,
  opts: GroupOpts,
): Promise<FeedSourceSpec | null> {
  if (m.source === "reddit") {
    const adapter = manager.reddit();
    const communityId = buildId({
      source: "reddit",
      instance: adapter.instance,
      kind: "community",
      nativeId: m.name,
    });
    return {
      key: `reddit:${m.name.toLowerCase()}`,
      adapter,
      query: { communityId, sort: opts.sort, timeWindow: opts.timeWindow },
    };
  }

  const instance = (m.instance ?? manager.defaultLemmy).toLowerCase();
  const adapter = manager.adapterForEntity({ source: "lemmy", instance });
  if (!adapter.resolveRemoteUrl) return null;
  try {
    const resolved = await adapter.resolveRemoteUrl(
      `https://${instance}/c/${m.name}`,
    );
    if (resolved.kind !== "community") return null;
    return {
      key: `lemmy:${instance}:${m.name.toLowerCase()}`,
      adapter,
      query: {
        communityId: resolved.id,
        sort: opts.sort,
        timeWindow: opts.timeWindow,
      },
    };
  } catch {
    return null; // member unresolvable right now — skip, don't sink the group
  }
}

export function createGroupFeed(
  manager: AccountManager,
  members: CommunityAddress[],
  opts: GroupOpts,
): (page: PageRequest) => Promise<Page<Post>> {
  let specsPromise: Promise<FeedSourceSpec[]> | null = null;
  const resolveAll = async (): Promise<FeedSourceSpec[]> => {
    const settled = await Promise.allSettled(
      members.map((m) => resolveMember(manager, m, opts)),
    );
    return settled.flatMap((r) =>
      r.status === "fulfilled" && r.value ? [r.value] : [],
    );
  };
  return async function fetchPage(page: PageRequest): Promise<Page<Post>> {
    if (!specsPromise) specsPromise = resolveAll();
    const specs = await specsPromise;
    if (specs.length === 0) return { items: [] };
    return createAggregateFeed(specs)(page);
  };
}
