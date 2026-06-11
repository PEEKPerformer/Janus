import { benchSummary, lastBench, runAiBench } from "../aiLensBench";
import type { AiLensResult } from "../aiLens";

const ok: AiLensResult = { kind: "too-short", tokens: 1 };

describe("runAiBench", () => {
  it("times the full window and the short check separately, and persists", async () => {
    // now() is consulted exactly four times: t0, t1, t2, and the timestamp.
    const ticks = [0, 3200, 3650, 3650];
    const now = () => ticks.shift() ?? 9999;
    const texts: string[] = [];
    const result = await runAiBench(
      async (t) => {
        texts.push(t);
        return ok;
      },
      { now, salt: "fixed" },
    );
    expect(result.fullMs).toBe(3200);
    expect(result.shortMs).toBe(450);
    expect(texts[0].length).toBeGreaterThan(texts[1].length);
    // Salted so the verdict cache can't fake an instant result.
    expect(texts[0]).toContain("fixed");
    expect(lastBench()).toMatchObject({ fullMs: 3200, shortMs: 450 });
  });

  it("benchSummary speaks seconds and milliseconds", () => {
    expect(
      benchSummary({ backend: "XNNPACK", fullMs: 3200, shortMs: 450, at: 1 }),
    ).toBe("XNNPACK · 3.2s full window · 450ms typical comment");
    expect(
      benchSummary({ backend: null, fullMs: 900, shortMs: 80, at: 1 }),
    ).toMatch(/^engine · 900ms/);
  });
});
