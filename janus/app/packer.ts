import type { Post } from "../core/model";
import type { SourceAdapter } from "../core/adapter";
import type { PackPrefs } from "./packPrefs";
import { parseId, type JanusId, type SourceKind } from "../core/ids";
import { listReadLater } from "./readLater";
import { listAllSeries } from "./threadSeries";
import { resolveSeriesEdition } from "./seriesResolve";
import { COMMENTS_CACHE, commentsCacheKey } from "./contentCaches";
import {
  beginPack,
  upsertPackedItem,
  savePackedPost,
  type PackOrigin,
  type PackStatus,
} from "./offlinePack";

/**
 * The plane-mode packer. Bulk-warms the stores the app ALREADY reads — the
 * shared comments cache (so PostScreen paints offline through its normal
 * path) and expo-image's disk cache (so `<Image>` finds the bytes) — for a
 * chosen scope: the Read Later queue, the newest edition of every followed
 * thread series, and a snapshot of the home feed. Cross-network by
 * construction: every target routes through `adapterForEntity` on its
 * JanusId, so a Lemmy thread packs exactly like a subreddit's.
 *
 * Pure orchestration over injected effects (prefetch, sleep, clock), so the
 * whole flight-bag flow is testable without a device. Pacing keeps Reddit
 * happy: one API call ~every `paceMs`, with the transport's 429/Retry-After
 * backoff underneath as the hard floor.
 */

export interface PackScope {
  readLater: boolean;
  series: boolean;
  feedSnapshot: boolean;
  /** Specific communities to pack (JanusId + handle), beyond the home feed. */
  communities?: { id: string; handle: string }[];
  /** Posts packed per chosen community. */
  communityLimit?: number;
  /** False = text-only pack (no image prefetch). */
  includeImages?: boolean;
  /**
   * Judge packed text with AI Lens while packing (deps.judgeText required).
   * The pack session is the one place "auto-scan" is honest about its cost —
   * the user already agreed to leave the phone open and working.
   */
  aiScan?: boolean;
}

/**
 * The PackScope the user's saved prefs describe. Shared by the Plane Mode screen
 * and the background refresher so the two never drift. `aiReady` gates AI Lens
 * scanning on the model actually being loaded.
 */
export function buildPackScope(prefs: PackPrefs, aiReady: boolean): PackScope {
  return {
    readLater: prefs.readLater,
    series: prefs.series,
    feedSnapshot: prefs.feedSnapshot,
    communities: prefs.communities,
    communityLimit: prefs.communityLimit,
    includeImages: prefs.includeImages,
    aiScan: aiReady && prefs.aiScan,
  };
}

export interface PackProgress {
  /** gather = resolving the target list; pack = downloading thread N of M. */
  phase: "gather" | "pack";
  done: number;
  total: number;
  title: string;
}

export interface PackSummary {
  total: number;
  packed: number;
  partial: number;
  failed: number;
  cancelled: boolean;
}

export interface PackDeps {
  reddit: SourceAdapter;
  lemmy: SourceAdapter;
  adapterForEntity: (e: {
    source: SourceKind;
    instance: string;
  }) => SourceAdapter;
  /** The sort PostScreen will resolve for this post — cache-key parity. */
  resolveSort: (adapter: SourceAdapter, communityId: string) => Promise<string>;
  /** Pull image bytes into expo-image's disk cache (Image.prefetch). */
  prefetchImage: (url: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onProgress?: (p: PackProgress) => void;
  shouldStop?: () => boolean;
  /** Posts per source in the feed snapshot. */
  feedLimit?: number;
  /** Max gallery images packed per post (thumbnails always pack). */
  galleryCap?: number;
  /** Delay between API-bound steps. */
  paceMs?: number;
  /**
   * AI Lens hook: judge one text on-device (verdicts land in the detector's
   * own cache — nothing to thread back). Failures are swallowed per text.
   */
  judgeText?: (text: string) => Promise<unknown>;
  /** Root comments judged per thread when aiScan is on. */
  aiRootsCap?: number;
}

/**
 * Image URLs worth packing for a post: its thumbnail, every media thumbnail,
 * full-size stills, and gallery images up to the cap. Videos pack only their
 * poster frame — an HLS stream can't be cached as a file.
 */
export function imageUrlsFor(post: Post, galleryCap = 10): string[] {
  const urls: string[] = [];
  const push = (u?: string) => {
    if (u && /^https?:/i.test(u) && !urls.includes(u)) urls.push(u);
  };
  push(post.thumbnail?.thumbnailUrl ?? post.thumbnail?.url);
  let galleryUsed = 0;
  for (const m of post.media) {
    push(m.thumbnailUrl);
    if (m.kind === "image") push(m.url);
    else if (m.kind === "gallery" && galleryUsed < galleryCap) {
      push(m.url);
      galleryUsed++;
    }
  }
  return urls;
}

/** Rough item count for the scope (drives the "~N items · ~M min" estimate). */
export function estimatePackTotal(scope: PackScope, feedLimit = 50): number {
  let n = 0;
  if (scope.readLater) n += listReadLater().length;
  if (scope.series) n += listAllSeries().length;
  n += (scope.communities?.length ?? 0) * (scope.communityLimit ?? 25);
  if (scope.feedSnapshot) n += feedLimit * 2;
  return n;
}

interface PackTarget {
  post: Post;
  origin: PackOrigin;
}

async function collectTargets(
  scope: PackScope,
  deps: Required<Pick<PackDeps, "sleep" | "paceMs" | "feedLimit">> & PackDeps,
): Promise<{ targets: PackTarget[]; unreachable: number }> {
  const targets: PackTarget[] = [];
  let unreachable = 0;
  const stopped = () => deps.shouldStop?.() === true;

  if (scope.readLater) {
    for (const entry of listReadLater()) {
      if (stopped()) break;
      deps.onProgress?.({
        phase: "gather",
        done: targets.length,
        total: 0,
        title: entry.title,
      });
      try {
        const parts = parseId(entry.id as JanusId);
        const adapter = deps.adapterForEntity({
          source: parts.source as SourceKind,
          instance: parts.instance,
        });
        targets.push({
          post: await adapter.getPost(entry.id as JanusId),
          origin: "readLater",
        });
      } catch {
        unreachable++;
        upsertPackedItem({
          id: entry.id,
          title: entry.title,
          community: entry.community,
          source: entry.source,
          commentCount: entry.commentCount,
          origin: "readLater",
          status: "failed",
        });
      }
      await deps.sleep(deps.paceMs);
    }
  }

  if (scope.series) {
    for (const series of listAllSeries()) {
      if (stopped()) break;
      deps.onProgress?.({
        phase: "gather",
        done: targets.length,
        total: 0,
        title: series.label,
      });
      try {
        const parts = parseId(series.communityId as JanusId);
        const adapter = deps.adapterForEntity({
          source: parts.source as SourceKind,
          instance: parts.instance,
        });
        // Same resolution as comment watches: newest post in the community
        // whose title normalizes into this series.
        const newest = await resolveSeriesEdition(
          adapter,
          series.communityId,
          series.label,
          series.seriesKey,
        );
        if (newest) targets.push({ post: newest, origin: "series" });
      } catch {
        unreachable++;
      }
      await deps.sleep(deps.paceMs);
    }
  }

  if (scope.communities?.length) {
    for (const c of scope.communities) {
      if (stopped()) break;
      deps.onProgress?.({
        phase: "gather",
        done: targets.length,
        total: 0,
        title: c.handle,
      });
      try {
        const parts = parseId(c.id as JanusId);
        const adapter = deps.adapterForEntity({
          source: parts.source as SourceKind,
          instance: parts.instance,
        });
        const page = await adapter.getFeed(
          {
            communityId: c.id as JanusId,
            sort: adapter.capabilities.sorts.feed[0]?.id,
          },
          { limit: scope.communityLimit ?? 25 },
        );
        for (const post of page.items)
          targets.push({ post, origin: "community" });
      } catch {
        unreachable++;
      }
      await deps.sleep(deps.paceMs);
    }
  }

  if (scope.feedSnapshot && !stopped()) {
    for (const adapter of [deps.reddit, deps.lemmy]) {
      if (stopped()) break;
      deps.onProgress?.({
        phase: "gather",
        done: targets.length,
        total: 0,
        title: "your feed",
      });
      try {
        // Mirrors feedSources' "subscribed" mode per source.
        const listingType = adapter.source === "reddit" ? "home" : "Subscribed";
        const page = await adapter.getFeed(
          { listingType, sort: adapter.capabilities.sorts.feed[0]?.id },
          { limit: deps.feedLimit },
        );
        for (const post of page.items) targets.push({ post, origin: "feed" });
      } catch {
        unreachable++;
      }
      await deps.sleep(deps.paceMs);
    }
  }

  // De-dupe: a read-later thread also in the feed packs once (under the
  // earlier, more intentional origin). dedupKey folds federated echoes too.
  const seen = new Set<string>();
  const deduped = targets.filter((t) => {
    const k = t.post.dedupKey ?? t.post.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { targets: deduped, unreachable };
}

export async function runPack(
  scope: PackScope,
  deps: PackDeps,
): Promise<PackSummary> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const full = {
    ...deps,
    sleep,
    now,
    paceMs: deps.paceMs ?? 600,
    feedLimit: deps.feedLimit ?? 50,
  };
  const stopped = () => deps.shouldStop?.() === true;

  beginPack(now());
  const { targets, unreachable } = await collectTargets(scope, full);

  const summary: PackSummary = {
    total: targets.length,
    packed: 0,
    partial: 0,
    failed: unreachable,
    cancelled: false,
  };

  let done = 0;
  for (const target of targets) {
    if (stopped()) {
      summary.cancelled = true;
      break;
    }
    const { post, origin } = target;
    deps.onProgress?.({
      phase: "pack",
      done,
      total: targets.length,
      title: post.title,
    });

    const parts = parseId(post.id as JanusId);
    const adapter = deps.adapterForEntity({
      source: parts.source as SourceKind,
      instance: parts.instance,
    });

    let status: PackStatus = "packed";
    savePackedPost(post);
    const judge = async (text?: string) => {
      if (!scope.aiScan || !deps.judgeText) return;
      if (!text?.trim() || stopped()) return;
      try {
        await deps.judgeText(text);
      } catch {
        /* judging is best-effort garnish on the pack */
      }
    };
    await judge(post.body?.text);
    try {
      const sort = await deps.resolveSort(adapter, post.community.id);
      const page = await adapter.getComments(post.id as JanusId, {
        sort: sort || undefined,
        limit: 100,
      });
      COMMENTS_CACHE.write(
        commentsCacheKey(post.source, post.id, sort),
        page,
        now(),
      );
      if (scope.aiScan && deps.judgeText) {
        // Pre-judge the thread's highest-leverage comments so the pack opens
        // with chips (and the user's policy) already applied, fully offline.
        const roots = page.items
          .filter((c) => !c.parentId)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, deps.aiRootsCap ?? 10);
        for (const c of roots) await judge(c.body?.text);
      }
    } catch {
      status = "partial";
    }
    if (scope.includeImages !== false) {
      for (const url of imageUrlsFor(post, full.galleryCap ?? 10)) {
        if (stopped()) break;
        try {
          await deps.prefetchImage(url);
        } catch {
          if (status === "packed") status = "partial";
        }
      }
    }

    upsertPackedItem({
      id: post.id,
      title: post.title,
      community: post.community.handle,
      source: post.source,
      commentCount: post.commentCount,
      origin,
      status,
    });
    if (status === "packed") summary.packed++;
    else summary.partial++;

    done++;
    deps.onProgress?.({
      phase: "pack",
      done,
      total: targets.length,
      title: post.title,
    });
    if (done < targets.length) await sleep(full.paceMs);
  }

  return summary;
}
