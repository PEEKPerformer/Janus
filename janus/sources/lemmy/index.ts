/**
 * Lemmy source — public entry. The factory wires the platform `fetch` (RN
 * provides it; no XHR quirks like Reddit needs) with typed-error mapping. The
 * adapter + mappers stay pure and unit-testable via an injected fetchJson.
 */
import { LemmyAdapter, type FetchJson } from "./lemmy-adapter";
import {
  NotAuthenticatedError,
  NotFoundError,
  RateLimitError,
  NetworkError,
} from "../../core/errors";

const realFetchJson: FetchJson = async (url, init) => {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal,
  });
  if (!res.ok) {
    // Lemmy reports failures as JSON `{ error: "incorrect_login" | ... }`.
    // Carry that code into the thrown message so callers (e.g. login) can map
    // it to a friendly, specific message instead of a bare status.
    let detail = "";
    try {
      const body = await res.clone().json();
      if (body?.error) detail = String(body.error);
    } catch {
      /* non-JSON body — ignore */
    }
    if (res.status === 401 || res.status === 403)
      throw new NotAuthenticatedError(detail || undefined);
    if (res.status === 404) throw new NotFoundError();
    if (res.status === 429) throw new RateLimitError();
    throw new NetworkError(
      detail ? `Lemmy: ${detail}` : `Lemmy HTTP ${res.status}`,
      res.status,
    );
  }
  return res.json();
};

export const DEFAULT_LEMMY_INSTANCE = "lemmy.world";

export function createLemmyAdapter(
  instance: string = DEFAULT_LEMMY_INSTANCE,
  jwt?: string,
): LemmyAdapter {
  return new LemmyAdapter({ instance, fetchJson: realFetchJson, jwt });
}

export { LemmyAdapter } from "./lemmy-adapter";
export { LEMMY_CAPABILITIES } from "./capabilities";
