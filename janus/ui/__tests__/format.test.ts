import { compactNumber, relativeTime } from "../format";

describe("compactNumber", () => {
  it("formats magnitudes", () => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(1234)).toBe("1.2k");
    expect(compactNumber(12345)).toBe("12k");
    expect(compactNumber(1_500_000)).toBe("1.5m");
    expect(compactNumber(-42)).toBe("-42");
  });
  it("rolls 999,999 up to the m unit instead of '1000k'", () => {
    expect(compactNumber(999_999)).toBe("1m");
    expect(compactNumber(999_000)).toBe("999k");
  });
  it("returns '0' for non-finite input", () => {
    expect(compactNumber(NaN)).toBe("0");
    expect(compactNumber(Infinity)).toBe("0");
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000_000;
  it("renders compact relative ages", () => {
    expect(relativeTime(now - 30_000, now)).toBe("now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d");
    expect(relativeTime(now - 4 * 7 * 86_400_000, now)).toBe("4w");
    expect(relativeTime(now - 2 * 365 * 86_400_000, now)).toBe("2y");
  });
  it("returns empty for a falsy timestamp", () => {
    expect(relativeTime(0, now)).toBe("");
  });
});
