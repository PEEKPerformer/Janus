/**
 * Usage analytics (PostHog) — dogfooding telemetry, not product spyware.
 *
 * Janus is a personal app; events go to the OWNER's own PostHog project so
 * real-world behavior (and incidents like Reddit rate-limit bans) can be
 * inspected after the fact. Ground rules:
 *   - No content: never post/comment text, titles, URLs, usernames, or
 *     community names. Event payloads are counts, durations, kinds, and codes.
 *   - Fail-open: with no key configured (or in demo mode) every call is a
 *     no-op — the app never depends on analytics being up.
 *   - The PostHog client is injected behind {@link AnalyticsClient}, so this
 *     module (and everything instrumented through it) unit-tests in node.
 *
 * The key is a PUBLISHABLE project key (phc_…), inlined at bundle time via
 * EXPO_PUBLIC_POSTHOG_API_KEY — safe to embed, it can only ingest events.
 */

/** The slice of PostHog's API Janus uses; fakes implement this in tests. */
export interface AnalyticsClient {
  capture(event: string, properties?: Record<string, unknown>): void;
  screen(name: string, properties?: Record<string, unknown>): void;
}

let client: AnalyticsClient | null = null;

/** Inject a client (or null to disable). Exposed for tests and entry wiring. */
export function configureAnalytics(c: AnalyticsClient | null): void {
  client = c;
}

/**
 * Production wiring: build the real PostHog client if a key is configured.
 * `require`d lazily so importing this module never drags posthog-react-native
 * (and its RN internals) into node test environments.
 */
export function initAnalytics(): void {
  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  if (!apiKey) return;
  const host =
    process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { PostHog } = require("posthog-react-native");
    const { createMMKV } = require("react-native-mmkv");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const storage = createMMKV({ id: "janus.analytics" });
    client = new PostHog(apiKey, {
      host,
      // MMKV-backed persistence: sync, already a dependency, and keeps the
      // optional async-storage / expo-file-system peer paths out of play.
      customStorage: {
        getItem: (key: string) => storage.getString(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      captureAppLifecycleEvents: true,
      // Nothing on screen ever leaves the phone.
      enableSessionReplay: false,
    }) as AnalyticsClient;
  } catch {
    client = null; // analytics must never take the app down
  }
}

/** Record an event. Property values only — no content (see module doc). */
export function track(
  event: string,
  properties?: Record<string, string | number | boolean | undefined>,
): void {
  client?.capture(event, properties);
}

/** Record a screen view (navigation route name). */
export function trackScreen(name: string): void {
  client?.screen(name);
}
