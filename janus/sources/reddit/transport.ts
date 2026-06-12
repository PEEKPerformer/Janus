/**
 * The engineered Reddit transport.
 *
 * Hydra hits Reddit's web `.json` endpoints with ZERO rate-limit / 429 /
 * backoff / concurrency handling. Janus keeps that web approach but wraps it in
 * this transport, which adds:
 *   - a concurrency cap (so a feed render can't fire 50 parallel requests),
 *   - retry with exponential backoff on 429 / 5xx, honoring Retry-After
 *     (capped — see maxRetryAfterMs),
 *   - a rate-limit cooldown: once Reddit hard-429s us, requests fail fast as
 *     RateLimitError until the window passes instead of piling onto the ban,
 *   - typed errors instead of UI side effects (no Alert.alert in the data layer).
 *
 * It is deliberately PURE: the low-level fetch, the delay timer, and the
 * User-Agent are injected. In production the adapter injects Hydra's hard-won
 * `safeFetch` (XHR wrapper); in tests we inject fakes and assert backoff/retry/
 * error-mapping deterministically with no network and no React Native.
 */

import {
  NotAuthenticatedError,
  RateLimitError,
  NetworkError,
  ForbiddenError,
  NotFoundError,
  JanusError,
} from "../../core/errors";
import { REDDIT_USER_AGENT } from "./userAgent";

/** Minimal response contract; Hydra's SafeFetchResponse satisfies it. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  url: string;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface HttpRequest {
  method: string;
  headers: Record<string, string>;
  body?: string | null;
  signal?: AbortSignal;
}

export type LowLevelFetch = (
  url: string,
  req: HttpRequest,
) => Promise<HttpResponse>;

/** Per-request auth — NOT a global singleton (the Phase-0 de-globalization). */
export interface RedditAuth {
  modhash?: string;
}

export interface RedditTransportDeps {
  fetchImpl: LowLevelFetch;
  /** Defaults to setTimeout; injected in tests for determinism. */
  delay?: (ms: number) => Promise<void>;
  userAgent?: string;
  /** Defaults to Date.now; injected in tests (drives the rate-limit cooldown). */
  now?: () => number;
  /** Fired once each time a 429 puts the transport into cooldown (telemetry). */
  onRateLimited?: (info: { retryAfterSeconds?: number }) => void;
}

export interface RedditTransportOptions {
  maxConcurrency?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /**
   * The longest Retry-After we'll silently WAIT OUT in-request. Reddit's web
   * 429s can say "Retry-After: 600" — honoring that inline means a request
   * (and, via the semaphore + the caller's inFlight latch, the whole feed)
   * hangs for ten minutes with a spinner. Anything above this cap fails fast
   * as RateLimitError instead, so the UI can actually say "rate limited".
   */
  maxRetryAfterMs?: number;
  /** Cooldown length when a terminal 429 carries no usable Retry-After. */
  defaultCooldownMs?: number;
}

export interface RequestOptions {
  method?: string;
  /** Form fields; urlencoded into the body with the right Content-Type. */
  body?: Record<string, string | number | boolean | undefined>;
  auth?: RedditAuth;
  requireAuth?: boolean;
  parse?: "json" | "text";
  signal?: AbortSignal;
}

const DEFAULTS: Required<RedditTransportOptions> = {
  maxConcurrency: 6,
  maxRetries: 3,
  baseBackoffMs: 500,
  maxBackoffMs: 8000,
  maxRetryAfterMs: 15_000,
  defaultCooldownMs: 60_000,
};

const realDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Pure helpers (exported for tests) -------------------------------------

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function errorForStatus(
  status: number,
  retryAfterSec?: number,
): JanusError {
  switch (status) {
    case 401:
      return new NotAuthenticatedError();
    case 403:
      return new ForbiddenError();
    case 404:
      return new NotFoundError();
    case 429:
      return new RateLimitError(retryAfterSec);
    default:
      return new NetworkError(`HTTP ${status}`, status);
  }
}

// --- Transport -------------------------------------------------------------

export class RedditTransport {
  private readonly fetchImpl: LowLevelFetch;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  private readonly now: () => number;
  private readonly onRateLimited?: (info: {
    retryAfterSeconds?: number;
  }) => void;
  private readonly opts: Required<RedditTransportOptions>;

  private inFlight = 0;
  private readonly waiters: (() => void)[] = [];
  /**
   * Cooldown gate: while set (epoch ms), every request fails fast as
   * RateLimitError. Without it, each request queued behind the semaphore
   * independently burns its retries against the same hard per-IP limit —
   * prolonging the ban and making the app look hung instead of rate-limited.
   */
  private limitedUntil = 0;

  constructor(deps: RedditTransportDeps, options: RedditTransportOptions = {}) {
    this.fetchImpl = deps.fetchImpl;
    this.delay = deps.delay ?? realDelay;
    this.userAgent = deps.userAgent ?? REDDIT_USER_AGENT;
    this.now = deps.now ?? Date.now;
    this.onRateLimited = deps.onRateLimited;
    this.opts = { ...DEFAULTS, ...options };
  }

  /** Seconds until the cooldown lifts; 0 when not rate-limited. */
  rateLimitedForSeconds(): number {
    return Math.max(0, Math.ceil((this.limitedUntil - this.now()) / 1000));
  }

  async request<T = unknown>(
    url: string,
    options: RequestOptions = {},
  ): Promise<T> {
    if (options.requireAuth && !options.auth?.modhash) {
      throw new NotAuthenticatedError();
    }
    const limited = this.rateLimitedForSeconds();
    if (limited > 0) throw new RateLimitError(limited);
    await this.acquire();
    try {
      return await this.attempt<T>(url, options, 0);
    } finally {
      this.release();
    }
  }

  private enterCooldown(retryAfterSec?: number): RateLimitError {
    const ms =
      retryAfterSec !== undefined
        ? retryAfterSec * 1000
        : this.opts.defaultCooldownMs;
    const until = this.now() + ms;
    if (until > this.limitedUntil) {
      this.limitedUntil = until;
      this.onRateLimited?.({ retryAfterSeconds: retryAfterSec });
    }
    return new RateLimitError(retryAfterSec ?? Math.ceil(ms / 1000));
  }

  private async attempt<T>(
    url: string,
    options: RequestOptions,
    attemptNo: number,
  ): Promise<T> {
    const req = this.buildRequest(options);

    let res: HttpResponse;
    try {
      res = await this.fetchImpl(url, req);
    } catch (e) {
      // Network/timeout. AbortError should propagate, not retry.
      if (e instanceof Error && e.name === "AbortError") throw e;
      if (attemptNo < this.opts.maxRetries) {
        await this.backoff(attemptNo);
        return this.attempt<T>(url, options, attemptNo + 1);
      }
      throw new NetworkError(
        e instanceof Error ? e.message : "Network request failed",
      );
    }

    if (res.ok) {
      return options.parse === "text"
        ? ((await res.text()) as unknown as T)
        : await res.json<T>();
    }

    const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
    if (res.status === 429) {
      // A Retry-After too long to wait out inline, or retries exhausted:
      // enter cooldown and fail fast rather than hanging the caller.
      const waitMs = retryAfter !== undefined ? retryAfter * 1000 : undefined;
      const tooLong =
        waitMs !== undefined && waitMs > this.opts.maxRetryAfterMs;
      if (tooLong || attemptNo >= this.opts.maxRetries) {
        throw this.enterCooldown(retryAfter);
      }
      await this.backoff(attemptNo, retryAfter);
      return this.attempt<T>(url, options, attemptNo + 1);
    }
    if (isRetryableStatus(res.status) && attemptNo < this.opts.maxRetries) {
      await this.backoff(attemptNo, retryAfter);
      return this.attempt<T>(url, options, attemptNo + 1);
    }
    throw errorForStatus(res.status, retryAfter);
  }

  private backoff(attemptNo: number, retryAfterSec?: number): Promise<void> {
    if (retryAfterSec !== undefined) return this.delay(retryAfterSec * 1000);
    const exp = this.opts.baseBackoffMs * 2 ** attemptNo;
    return this.delay(Math.min(exp, this.opts.maxBackoffMs));
  }

  private buildRequest(options: RequestOptions): HttpRequest {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
    };
    if (options.auth?.modhash) headers["X-Modhash"] = options.auth.modhash;

    let body: string | null = null;
    if (options.body) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(options.body)) {
        if (v !== undefined) params.append(k, String(v));
      }
      body = params.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    return {
      method: options.method ?? "GET",
      headers,
      body,
      signal: options.signal,
    };
  }

  // Concurrency semaphore. A released slot is handed directly to the next
  // waiter (inFlight unchanged) so the cap is never exceeded.
  private acquire(): Promise<void> {
    if (this.inFlight < this.opts.maxConcurrency) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((res) => this.waiters.push(res));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.inFlight--;
  }
}
