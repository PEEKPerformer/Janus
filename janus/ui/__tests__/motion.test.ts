import { SPRING, PRESS_SCALE, rubberBand } from "../motion";

describe("motion vocabulary", () => {
  it("exposes exactly the three named springs, all spring-physics configs", () => {
    expect(Object.keys(SPRING).sort()).toEqual(["gentle", "playful", "snappy"]);
    for (const s of Object.values(SPRING)) {
      // dampingRatio is the whole personality — keep them in the "alive, not a
      // toy, not stiff" band so no future edit silently flattens the feel.
      expect(s.dampingRatio).toBeGreaterThan(0.5);
      expect(s.dampingRatio).toBeLessThanOrEqual(1);
      expect(s.duration).toBeGreaterThan(0);
    }
    // playful bounces more than gentle barely does.
    expect(SPRING.playful.dampingRatio!).toBeLessThan(
      SPRING.gentle.dampingRatio!,
    );
  });

  it("PRESS_SCALE is a subtle dip, not a squash", () => {
    expect(PRESS_SCALE).toBeGreaterThan(0.9);
    expect(PRESS_SCALE).toBeLessThan(1);
  });
});

describe("rubberBand resistance", () => {
  it("is zero at the limit and grows from there", () => {
    expect(rubberBand(0, 80)).toBe(0);
    expect(rubberBand(20, 80)).toBeGreaterThan(0);
  });

  it("is odd-symmetric (pull either way feels the same)", () => {
    expect(rubberBand(-40, 80)).toBeCloseTo(-rubberBand(40, 80));
  });

  it("compresses harder the further you pull, never escaping the dimension", () => {
    const a = rubberBand(40, 80);
    const b = rubberBand(200, 80);
    const c = rubberBand(100000, 80);
    expect(b).toBeGreaterThan(a); // monotonic
    expect(b).toBeLessThan(80); // bounded by the asymptote
    expect(c).toBeLessThan(80);
    expect(c).toBeGreaterThan(79); // asymptotically approaches it
    // Real travel is always less than a 1:1 drag — that's the "heavy" feel.
    expect(rubberBand(50, 80)).toBeLessThan(50);
  });
});
