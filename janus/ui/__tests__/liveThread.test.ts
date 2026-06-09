import { diffNewIds, LIVE_REFRESH_MS } from "../liveThread";

describe("diffNewIds (live thread refresh)", () => {
  it("returns only ids not already known, preserving order", () => {
    const known = new Set(["a", "b"]);
    expect(
      diffNewIds(known, [{ id: "a" }, { id: "c" }, { id: "b" }, { id: "d" }]),
    ).toEqual(["c", "d"]);
  });

  it("handles a first refresh (everything known) and duplicates", () => {
    expect(diffNewIds(new Set(["a"]), [{ id: "a" }])).toEqual([]);
    // The same id twice in one page (federation echo) counts once.
    expect(diffNewIds(new Set(), [{ id: "x" }, { id: "x" }])).toEqual(["x"]);
  });

  it("refresh cadence is gentle on rate limits", () => {
    expect(LIVE_REFRESH_MS).toBeGreaterThanOrEqual(15_000);
  });
});
