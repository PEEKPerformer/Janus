import {
  APPROVAL_CHECK_MIN_MS,
  approvalIsReady,
  clearApprovalReminder,
  markAwaitingApproval,
  maybeCheckApproval,
} from "../aiLensReminder";
import { setHfToken } from "../pangramToken";
import { setPangramState } from "../pangramModel";
import type { HubFetch } from "../pangramHub";

const REPO_BODY = {
  sha: "abc",
  siblings: [
    { rfilename: "config.json" },
    { rfilename: "vocab.json" },
    { rfilename: "merges.txt" },
    { rfilename: "model.safetensors" },
  ],
};
const respond =
  (status: number): HubFetch =>
  async () => ({
    status,
    json: async () => REPO_BODY,
    text: async () => "",
  });

describe("maybeCheckApproval", () => {
  beforeEach(async () => {
    await setHfToken("hf_test");
  });

  it("does nothing unless the user is known to be waiting", async () => {
    expect(await maybeCheckApproval(respond(200))).toBe(false);
  });

  it("waiting + gate opens -> ready sticks until cleared", async () => {
    markAwaitingApproval();
    expect(await maybeCheckApproval(respond(200))).toBe(true);
    expect(approvalIsReady()).toBe(true);
    // Sticky across launches without re-fetching.
    expect(await maybeCheckApproval(respond(403))).toBe(true);
    clearApprovalReminder();
    expect(await maybeCheckApproval(respond(200))).toBe(false);
  });

  it("still gated -> stays quiet and throttles re-checks", async () => {
    markAwaitingApproval();
    let calls = 0;
    const gated: HubFetch = async () => {
      calls++;
      return { status: 403, json: async () => ({}), text: async () => "" };
    };
    let t = 100_000_000_000; // far past the throttle window from epoch
    const now = () => t;
    expect(await maybeCheckApproval(gated, now)).toBe(false);
    expect(await maybeCheckApproval(gated, now)).toBe(false); // throttled
    expect(calls).toBe(1);
    t += APPROVAL_CHECK_MIN_MS + 1;
    await maybeCheckApproval(gated, now);
    expect(calls).toBe(2);
  });

  it("an existing install stands the reminder down", async () => {
    markAwaitingApproval();
    setPangramState({ phase: "ready" });
    expect(await maybeCheckApproval(respond(200))).toBe(false);
    expect(approvalIsReady()).toBe(false);
  });

  it("a revoked token cancels the wait", async () => {
    markAwaitingApproval();
    let t = 100_000_000_000;
    expect(await maybeCheckApproval(respond(401), () => t)).toBe(false);
    t += APPROVAL_CHECK_MIN_MS + 1;
    // No longer awaiting — no further fetches.
    let calls = 0;
    const counting: HubFetch = async () => {
      calls++;
      return { status: 200, json: async () => REPO_BODY, text: async () => "" };
    };
    expect(await maybeCheckApproval(counting, () => t)).toBe(false);
    expect(calls).toBe(0);
  });
});
