import * as SecureStore from "expo-secure-store";

/**
 * Lightweight on-device usage counters — a fun, private "your year in review"
 * surface. Never leaves the device; purely local tallies bumped at key actions.
 * Source-agnostic: a vote is a vote whether it landed on Reddit or Lemmy.
 */

const KEY = "janus.usageStats.v1";

export interface UsageStats {
  postsOpened: number;
  commentsPosted: number;
  postsCreated: number;
  votesCast: number;
  /** Epoch ms of the first recorded action, for "since…". */
  since: number;
}

export type UsageCounter = Exclude<keyof UsageStats, "since">;

const EMPTY: UsageStats = {
  postsOpened: 0,
  commentsPosted: 0,
  postsCreated: 0,
  votesCast: 0,
  since: 0,
};

function coerce(raw: unknown): UsageStats {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const num = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
  return {
    postsOpened: num(o.postsOpened),
    commentsPosted: num(o.commentsPosted),
    postsCreated: num(o.postsCreated),
    votesCast: num(o.votesCast),
    since: num(o.since),
  };
}

export async function loadUsageStats(): Promise<UsageStats> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? coerce(JSON.parse(raw)) : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

/** Increment a counter by `by` (default 1). `now` is injectable for tests. */
export async function bumpUsage(
  counter: UsageCounter,
  now: number,
  by = 1,
): Promise<void> {
  const cur = await loadUsageStats();
  const next: UsageStats = {
    ...cur,
    [counter]: cur[counter] + by,
    since: cur.since || now,
  };
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
}

export async function resetUsageStats(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* non-fatal */
  }
}
