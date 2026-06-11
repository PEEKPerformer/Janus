import { createAiQueue } from "../aiLensQueue";
import type { AiLensResult } from "../aiLens";

const verdict = (label: string): AiLensResult => ({
  kind: "verdict",
  verdict: {
    index: 0,
    label,
    probs: [],
    confidence: 0.9,
    peakIndex: 0,
    windows: 1,
    tokens: 60,
    truncated: false,
  },
});

/** A check whose first call blocks until released — lets tests stack a queue. */
function gatedCheck() {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let first = true;
  const check = async (text: string): Promise<AiLensResult> => {
    if (first) {
      first = false;
      await gate;
    }
    order.push(text);
    return verdict(text);
  };
  return { check, order, release: () => release() };
}

describe("createAiQueue", () => {
  it("runs taps before auto before prefetch, FIFO within a tier", async () => {
    const { check, order, release } = gatedCheck();
    const q = createAiQueue(check, { sleep: async () => {} });
    const all = [
      q.run("first", 1), // starts immediately (blocks on the gate)
      q.run("prefetch-a", 2),
      q.run("auto-a", 1),
      q.run("tap", 0),
      q.run("prefetch-b", 2),
      q.run("auto-b", 1),
    ];
    release();
    await Promise.all(all);
    expect(order).toEqual([
      "first",
      "tap",
      "auto-a",
      "auto-b",
      "prefetch-a",
      "prefetch-b",
    ]);
  });

  it("paces only after prefetch jobs, and notifies subscribers per job", async () => {
    const sleeps: number[] = [];
    const events: number[] = [];
    const q = createAiQueue(async (t) => verdict(t), {
      prefetchPaceMs: 500,
      sleep: async (ms) => void sleeps.push(ms),
    });
    q.subscribe(() => events.push(1));
    await Promise.all([q.run("a", 2), q.run("b", 2), q.run("c", 1)]);
    expect(events).toHaveLength(3);
    // c (auto) ran first with no pacing; pacing follows each prefetch
    // that still has work queued behind it.
    expect(sleeps).toEqual([500]);
  });

  it("sheds queued prefetch work without touching higher tiers", async () => {
    const { check, order, release } = gatedCheck();
    const q = createAiQueue(check, { sleep: async () => {} });
    const kept = [q.run("first", 1), q.run("auto", 1)];
    const shed = q.run("speculative", 2);
    const shedOutcome = shed.catch((e: Error) => e.message);
    q.shedPrefetch();
    release();
    await Promise.all(kept);
    expect(await shedOutcome).toBe("prefetch shed");
    expect(order).toEqual(["first", "auto"]);
    expect(q.size()).toBe(0);
  });

  it("a failing check rejects its caller but the queue keeps draining", async () => {
    const q = createAiQueue(
      async (t) => {
        if (t === "boom") throw new Error("engine sneezed");
        return verdict(t);
      },
      { sleep: async () => {} },
    );
    const results = await Promise.allSettled([
      q.run("boom", 1),
      q.run("ok", 1),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
  });
});
