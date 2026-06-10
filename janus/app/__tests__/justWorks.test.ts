import {
  isConnectivityError,
  NetworkError,
  RateLimitError,
  NotAuthenticatedError,
  ParseError,
} from "../../core/errors";
import {
  isOffline,
  reportConnectivityFailure,
  reportConnectivitySuccess,
  subscribeOffline,
  __setOffline,
  __resetOffline,
} from "../offline";

afterEach(() => __resetOffline());

describe("isConnectivityError (garage vs real error)", () => {
  it("transport-level failures are connectivity", () => {
    expect(
      isConnectivityError(new NetworkError("Network request failed")),
    ).toBe(true); // no status: no response ever arrived
    const abort = new Error("Aborted");
    abort.name = "AbortError";
    expect(isConnectivityError(abort)).toBe(true); // transport timeout
    expect(isConnectivityError(new TypeError("Network request failed"))).toBe(
      true,
    ); // Lemmy's bare fetch
  });

  it("server answers are NOT connectivity, even unhappy ones", () => {
    expect(isConnectivityError(new NetworkError("HTTP 503", 503))).toBe(false);
    expect(isConnectivityError(new RateLimitError(30))).toBe(false);
    expect(isConnectivityError(new NotAuthenticatedError())).toBe(false);
    expect(isConnectivityError(new ParseError("schema drift"))).toBe(false);
    expect(isConnectivityError(new Error("boom"))).toBe(false);
    expect(isConnectivityError("nope")).toBe(false);
  });
});

describe("offline inference from request failures", () => {
  it("a streak of failures flips offline; one success flips back", () => {
    reportConnectivityFailure();
    expect(isOffline()).toBe(false); // one blip isn't a verdict
    reportConnectivityFailure();
    expect(isOffline()).toBe(true); // two in a row: garage
    reportConnectivitySuccess();
    expect(isOffline()).toBe(false);
  });

  it("the flip notifies subscribers (drives the reconnect drain)", () => {
    const seen: boolean[] = [];
    subscribeOffline((o) => seen.push(o));
    reportConnectivityFailure();
    reportConnectivityFailure();
    reportConnectivitySuccess();
    expect(seen).toEqual([true, false]);
  });

  it("NetInfo coming back online clears the inferred verdict too", () => {
    reportConnectivityFailure();
    reportConnectivityFailure();
    expect(isOffline()).toBe(true);
    __setOffline(false); // NetInfo: definitely online again
    expect(isOffline()).toBe(false);
  });

  it("success does not override NetInfo saying offline", () => {
    __setOffline(true);
    reportConnectivitySuccess();
    expect(isOffline()).toBe(true);
  });
});
