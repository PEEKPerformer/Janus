/**
 * Reddit source — public entry. The factory wires Hydra's battle-tested
 * `safeFetch` (XHR wrapper) in as the transport's low-level fetch. This module
 * is the only Reddit-source file that touches React Native, so the adapter and
 * mappers stay unit-testable in node.
 */
import safeFetch from "./safeFetch";
import { RedditTransport, type LowLevelFetch } from "./transport";
import { RedditAdapter } from "./reddit-adapter";

const safeFetchLowLevel: LowLevelFetch = (url, req) =>
  safeFetch(url, {
    method: req.method,
    headers: req.headers,
    body: req.body ?? undefined,
  });

export interface CreateRedditOptions {
  /** Telemetry hook: fired once each time a 429 puts the transport into cooldown. */
  onRateLimited?: (info: { retryAfterSeconds?: number }) => void;
}

export function createRedditAdapter(
  opts: CreateRedditOptions = {},
): RedditAdapter {
  const transport = new RedditTransport({
    fetchImpl: safeFetchLowLevel,
    onRateLimited: opts.onRateLimited,
  });
  return new RedditAdapter({ transport });
}

export { RedditAdapter } from "./reddit-adapter";
export { RedditTransport } from "./transport";
export { REDDIT_CAPABILITIES } from "./capabilities";
