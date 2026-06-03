import { mergeRecent } from "../recentEmoji";

describe("mergeRecent", () => {
  it("moves the picked emoji to the front", () => {
    expect(mergeRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });
  it("dedupes (no repeats) and front-loads the newest", () => {
    expect(mergeRecent(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(mergeRecent(["a", "b"], "z")).toEqual(["z", "a", "b"]);
  });
  it("caps the list length", () => {
    const long = Array.from({ length: 40 }, (_, i) => `e${i}`);
    const out = mergeRecent(long, "new", 32);
    expect(out).toHaveLength(32);
    expect(out[0]).toBe("new");
  });
});
