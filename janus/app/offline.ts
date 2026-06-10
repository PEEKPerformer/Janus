import NetInfo from "@react-native-community/netinfo";

/**
 * App-wide connectivity, from TWO signals so the app "just works" in a
 * parking garage, not only in declared airplane mode:
 *
 *  - NetInfo: `isConnected === false` OR `isInternetReachable === false`
 *    (radio attached but no internet — the captive-portal/garage shape).
 *    Unknown/null is treated as online so a flaky probe never wrongly
 *    suppresses real fetches.
 *  - Inference: NetInfo often claims "connected" while every request dies.
 *    The data hooks report connectivity-shaped failures here; a short streak
 *    flips us offline (cache-serving, outbox-queueing, banner), and the first
 *    success — or NetInfo coming back — flips us right back.
 *
 * One subscription feeds a synchronous `isOffline()` (init once, read sync),
 * so non-React code — the SWR hook's fetch decision, vote handlers — can
 * branch without await.
 */

/** Consecutive connectivity-shaped failures before we infer offline. */
const FAIL_STREAK_THRESHOLD = 2;

let netOffline = false; // what NetInfo says
let inferred = false; // what request failures say
let failStreak = 0;
let effective = false;
let started = false;
const listeners = new Set<(offline: boolean) => void>();

/** Start watching connectivity. Safe to call repeatedly. */
export function initOffline(): void {
  if (started) return;
  started = true;
  NetInfo.addEventListener((state) => {
    netOffline =
      state.isConnected === false || state.isInternetReachable === false;
    if (!netOffline) {
      // The OS says we're back — drop any failure-inferred verdict too.
      inferred = false;
      failStreak = 0;
    }
    recompute();
  });
}

function recompute(): void {
  const next = netOffline || inferred;
  if (next === effective) return;
  effective = next;
  for (const l of [...listeners]) l(effective);
}

/**
 * A request failed in a connectivity-shaped way (see core/errors
 * isConnectivityError). A short streak infers offline even while NetInfo
 * still claims connected.
 */
export function reportConnectivityFailure(): void {
  failStreak++;
  if (failStreak >= FAIL_STREAK_THRESHOLD) {
    inferred = true;
    recompute();
  }
}

/** A request succeeded — connectivity is real, clear any inferred verdict. */
export function reportConnectivitySuccess(): void {
  failStreak = 0;
  if (inferred) {
    inferred = false;
    recompute();
  }
}

/** Synchronous — meaningful once {@link initOffline} has run. */
export function isOffline(): boolean {
  return effective;
}

/** Notify on every offline/online flip. Returns an unsubscribe. */
export function subscribeOffline(fn: (offline: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test-only: force the NetInfo-level flag (and fire listeners). */
export function __setOffline(next: boolean): void {
  netOffline = next;
  if (!next) {
    inferred = false;
    failStreak = 0;
  }
  recompute();
}

/** Test-only: drop all state so each test starts clean. */
export function __resetOffline(): void {
  netOffline = false;
  inferred = false;
  failStreak = 0;
  effective = false;
  started = false;
  listeners.clear();
}
