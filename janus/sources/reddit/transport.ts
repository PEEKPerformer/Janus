/**
 * The engineered Reddit transport.
 *
 * Hydra hits Reddit's web `.json` endpoints with ZERO rate-limit / 429 /
 * backoff / concurrency handling. Janus keeps that web approach but wraps it in
 * this transport, which adds:
 *   - a concurrency cap (so a feed render can't fire 50 parallel requests),
 *   - retry with exponential backoff on 429 / 5xx, honoring Retry-After,
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
}

export interface RedditTransportOptions {
  maxConcurrency?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
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
  private readonly opts: Required<RedditTransportOptions>;

  private inFlight = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(deps: RedditTransportDeps, options: RedditTransportOptions = {}) {
    this.fetchImpl = deps.fetchImpl;
    this.delay = deps.delay ?? realDelay;
    this.userAgent = deps.userAgent ?? REDDIT_USER_AGENT;
    this.opts = { ...DEFAULTS, ...options };
  }

  async request<T = unknown>(
    url: string,
    options: RequestOptions = {},
  ): Promise<T> {
    if (options.requireAuth && !options.auth?.modhash) {
      throw new NotAuthenticatedError();
    }
    await this.acquire();
    try {
      return await this.attempt<T>(url, options, 0);
    } finally {
      this.release();
    }
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
