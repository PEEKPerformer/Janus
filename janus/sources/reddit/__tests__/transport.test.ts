import {
  RedditTransport,
  LowLevelFetch,
  HttpResponse,
  HttpRequest,
  isRetryableStatus,
  parseRetryAfter,
  errorForStatus,
} from "../transport";
import {
  NotAuthenticatedError,
  RateLimitError,
  NotFoundError,
  ForbiddenError,
  NetworkError,
} from "../../../core/errors";

function res(
  status: number,
  jsonBody: unknown = {},
  headers: Record<string, string> = {},
): HttpResponse {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    url: "https://www.reddit.com/x.json",
    headers: { get: (n) => lower[n.toLowerCase()] ?? null },
    text: async () => JSON.stringify(jsonBody),
    json: async () => jsonBody as never,
  };
}

function scripted(responses: HttpResponse[]) {
  const calls: HttpRequest[] = [];
  const fn: LowLevelFetch = async (_url, req) => {
    calls.push(req);
    return responses[Math.min(calls.length - 1, responses.length - 1)];
  };
  return { fn, calls };
}

function recordingDelay() {
  const delays: number[] = [];
  return { delays, delay: async (ms: number) => void delays.push(ms) };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe("transport pure helpers", () => {
  it("classifies retryable statuses", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });

  it("parses Retry-After seconds", () => {
    expect(parseRetryAfter("3")).toBe(3);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("garbage")).toBeUndefined();
  });

  it("maps statuses to typed errors", () => {
    expect(errorForStatus(401)).toBeInstanceOf(NotAuthenticatedError);
    expect(errorForStatus(403)).toBeInstanceOf(ForbiddenError);
    expect(errorForStatus(404)).toBeInstanceOf(NotFoundError);
    expect(errorForStatus(429, 5)).toMatchObject({ retryAfterSeconds: 5 });
    expect(errorForStatus(500)).toBeInstanceOf(NetworkError);
  });
});

describe("RedditTransport", () => {
  it("throws NotAuthenticatedError before fetching when auth is required but missing", async () => {
    const { fn, calls } = scripted([res(200)]);
    const t = new RedditTransport({ fetchImpl: fn, userAgent: "test-ua" });
    await expect(
      t.request("/x.json", { requireAuth: true }),
    ).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(calls).toHaveLength(0);
  });

  it("returns parsed json and sets User-Agent + X-Modhash headers", async () => {
    const { fn, calls } = scripted([res(200, { hello: "world" })]);
    const t = new RedditTransport({ fetchImpl: fn, userAgent: "test-ua" });
    const out = await t.request<{ hello: string }>("/x.json", {
      auth: { modhash: "MH" },
    });
    expect(out).toEqual({ hello: "world" });
    expect(calls[0].headers["User-Agent"]).toBe("test-ua");
    expect(calls[0].headers["X-Modhash"]).toBe("MH");
    expect(calls[0].headers["Cache-Control"]).toBe("no-cache");
  });

  it("retries on 429 then succeeds, with exponential backoff", async () => {
    const { fn, calls } = scripted([res(429), res(200, { ok: true })]);
    const { delays, delay } = recordingDelay();
    const t = new RedditTransport(
      { fetchImpl: fn, delay, userAgent: "test-ua" },
      { baseBackoffMs: 500 },
    );
    const out = await t.request("/x.json");
    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([500]); // base * 2^0
  });

  it("honors Retry-After over exponential backoff", async () => {
    const { fn } = scripted([res(429, {}, { "Retry-After": "2" }), res(200)]);
    const { delays, delay } = recordingDelay();
    const t = new RedditTransport({
      fetchImpl: fn,
      delay,
      userAgent: "test-ua",
    });
    await t.request("/x.json");
    expect(delays).toEqual([2000]);
  });

  it("throws RateLimitError after exhausting retries on persistent 429", async () => {
    const { fn, calls } = scripted([res(429)]);
    const { delays, delay } = recordingDelay();
    const t = new RedditTransport(
      { fetchImpl: fn, delay, userAgent: "test-ua" },
      { maxRetries: 2, baseBackoffMs: 100 },
    );
    await expect(t.request("/x.json")).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(3); // initial + 2 retries
    expect(delays).toEqual([100, 200]);
  });

  it("retries on 5xx then succeeds", async () => {
    const { fn, calls } = scripted([res(503), res(200, { ok: 1 })]);
    const { delay } = recordingDelay();
    const t = new RedditTransport({
      fetchImpl: fn,
      delay,
      userAgent: "test-ua",
    });
    expect(await t.request("/x.json")).toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it("does NOT retry a 404 and throws NotFoundError", async () => {
    const { fn, calls } = scripted([res(404)]);
    const { delays, delay } = recordingDelay();
    const t = new RedditTransport({
      fetchImpl: fn,
      delay,
      userAgent: "test-ua",
    });
    await expect(t.request("/x.json")).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("urlencodes a form body and sets Content-Type", async () => {
    const { fn, calls } = scripted([res(200)]);
    const t = new RedditTransport({ fetchImpl: fn, userAgent: "test-ua" });
    await t.request("/api/vote", {
      method: "POST",
      body: { id: "t3_abc", dir: 1, skip: undefined },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(calls[0].body).toBe("id=t3_abc&dir=1"); // undefined skipped
  });

  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const gates: (() => void)[] = [];
    const fn: LowLevelFetch = async () => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await new Promise<void>((r) => gates.push(r));
      inFlight--;
      return res(200, { done: true });
    };
    const t = new RedditTransport(
      { fetchImpl: fn, userAgent: "test-ua" },
      { maxConcurrency: 2 },
    );

    const all = [0, 1, 2, 3].map(() => t.request("/x.json"));
    await tick();
    await tick();
    expect(maxObserved).toBe(2); // only 2 reached fetch
    expect(gates).toHaveLength(2);

    // release the first two; the queued two then proceed
    gates.forEach((g) => g());
    await tick();
    await tick();
    gates.slice(2).forEach((g) => g());
    await Promise.all(all);
    expect(maxObserved).toBe(2); // cap never exceeded
  });
});
