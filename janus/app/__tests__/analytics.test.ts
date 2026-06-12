import {
  configureAnalytics,
  setAnalyticsEnabled,
  track,
  trackScreen,
  type AnalyticsClient,
} from "../analytics";

function fakeClient() {
  const calls: { kind: string; name: string }[] = [];
  let optedOut = false;
  const client: AnalyticsClient = {
    capture: (event) => void calls.push({ kind: "capture", name: event }),
    screen: (name) => void calls.push({ kind: "screen", name }),
    optIn: () => void (optedOut = false),
    optOut: () => void (optedOut = true),
  };
  return { client, calls, isOptedOut: () => optedOut };
}

afterEach(() => configureAnalytics(null));

describe("analytics consent gate", () => {
  it("drops everything with no client configured", () => {
    track("feed_page", { ok: true });
    trackScreen("Feed"); // must not throw
  });

  it("tracks once configured, and stops the moment consent is withdrawn", () => {
    const { client, calls, isOptedOut } = fakeClient();
    configureAnalytics(client);
    track("feed_page");
    expect(calls).toEqual([{ kind: "capture", name: "feed_page" }]);

    setAnalyticsEnabled(false); // user opts out
    track("feed_page");
    trackScreen("Feed");
    expect(calls).toHaveLength(1); // nothing new got through
    expect(isOptedOut()).toBe(true); // and the SDK was told too

    setAnalyticsEnabled(true); // user opts back in
    trackScreen("Feed");
    expect(calls).toEqual([
      { kind: "capture", name: "feed_page" },
      { kind: "screen", name: "Feed" },
    ]);
    expect(isOptedOut()).toBe(false);
  });

  it("enabling without a client or factory stays a no-op", () => {
    setAnalyticsEnabled(true); // no key configured: nothing to build
    track("feed_page"); // must not throw
  });
});
