import { createMMKV } from "react-native-mmkv";

import { fetchRepoInfo, HubError, type HubFetch } from "./pangramHub";
import { getHfToken } from "./pangramToken";
import { getPangramState } from "./pangramModel";

/**
 * The approval-wait reminder. Pangram's gate is approved by hand — days,
 * sometimes weeks — and people forget they ever asked. When a gate check
 * comes back "not accepted", we remember that this user is WAITING; each
 * app launch (throttled) quietly re-checks, and the moment access opens,
 * the feed grows a "you're approved — finish setup" strip. No background
 * tasks, no notification permissions: the reminder meets the user where
 * they already are, the next time they open the app to browse.
 */

const store = createMMKV({ id: "janus.aiLensReminder.v1" });
const AWAITING = "awaiting";
const READY = "ready";
const LAST_CHECK = "lastCheck";

/** Re-check the gate at most this often. */
export const APPROVAL_CHECK_MIN_MS = 6 * 60 * 60 * 1000;

/** Call when a gate check / install fails with "gate-not-accepted". */
export function markAwaitingApproval(): void {
  try {
    store.set(AWAITING, "1");
    store.remove(READY);
  } catch {
    /* best-effort */
  }
}

/** Approval landed (or the model got installed) — stand down. */
export function clearApprovalReminder(): void {
  try {
    store.remove(AWAITING);
    store.remove(READY);
    store.remove(LAST_CHECK);
  } catch {
    /* best-effort */
  }
}

export function approvalIsReady(): boolean {
  try {
    return store.getString(READY) === "1";
  } catch {
    return false;
  }
}

/**
 * Launch-time poll: if this user is known to be waiting, re-check the gate
 * (throttled). Returns whether the "you're approved" strip should show.
 */
export async function maybeCheckApproval(
  fetchImpl: HubFetch,
  now: () => number = Date.now,
): Promise<boolean> {
  try {
    if (getPangramState().phase !== "none") {
      clearApprovalReminder();
      return false;
    }
    if (store.getString(READY) === "1") return true;
    if (store.getString(AWAITING) !== "1") return false;
    const last = Number(store.getString(LAST_CHECK) ?? 0);
    if (now() - last < APPROVAL_CHECK_MIN_MS) return false;
    store.set(LAST_CHECK, String(now()));
    const token = await getHfToken();
    if (!token) {
      clearApprovalReminder();
      return false;
    }
    await fetchRepoInfo(token, fetchImpl); // throws while still gated
    store.set(READY, "1");
    store.remove(AWAITING);
    return true;
  } catch (e) {
    if (e instanceof HubError && e.gate === "invalid-token")
      clearApprovalReminder(); // token revoked — nothing to wait for
    return false; // still pending / transport hiccup: try again next launch
  }
}
