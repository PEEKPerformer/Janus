import { scrubTime } from "../screens/ReelScreen";

describe("scrubTime (gif finger-scrub mapping)", () => {
  it("maps a full-width drag to the full duration", () => {
    expect(scrubTime(0, 200, 400, 4)).toBeCloseTo(2); // half width = half loop
    expect(scrubTime(1, 400, 400, 4)).toBeCloseTo(1); // full width wraps home
  });

  it("scrubs backwards and wraps past the start (gifs loop)", () => {
    expect(scrubTime(1, -200, 400, 4)).toBeCloseTo(3); // 1s - 2s wraps to 3s
    expect(scrubTime(0, -100, 400, 4)).toBeCloseTo(3);
  });

  it("wraps forward past the end", () => {
    expect(scrubTime(3.5, 100, 400, 4)).toBeCloseTo(0.5);
  });

  it("is safe before metadata loads (zero duration/width)", () => {
    expect(scrubTime(1, 50, 400, 0)).toBe(0);
    expect(scrubTime(1, 50, 0, 4)).toBe(0);
  });
});
