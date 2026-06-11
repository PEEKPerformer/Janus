import {
  chipColorFor,
  chipLabelFor,
  CONFIDENCE_FLOOR,
  DEFAULT_AI_POLICY,
  getAiLensPolicy,
  levelKeyFor,
  setAiLensPolicy,
  treatmentFor,
} from "../aiLensPolicy";

describe("treatmentFor (the policy ladder)", () => {
  const policy = {
    light: "none",
    moderate: "dim",
    full: "hide",
  } as const;

  it("human verdicts get nothing, ever", () => {
    expect(treatmentFor({ index: 0, confidence: 0.99 }, policy)).toBe("none");
  });

  it("maps each level to its chosen treatment when confident", () => {
    expect(treatmentFor({ index: 1, confidence: 0.9 }, policy)).toBe("none");
    expect(treatmentFor({ index: 2, confidence: 0.9 }, policy)).toBe("dim");
    expect(treatmentFor({ index: 3, confidence: 0.9 }, policy)).toBe("hide");
  });

  it("caps uncertain verdicts at 'label' — never auto-fold a coin toss", () => {
    expect(
      treatmentFor({ index: 3, confidence: CONFIDENCE_FLOOR - 0.01 }, policy),
    ).toBe("label");
    expect(
      treatmentFor({ index: 2, confidence: CONFIDENCE_FLOOR - 0.01 }, policy),
    ).toBe("label");
    // "none" and "label" are already harmless — the floor doesn't touch them.
    expect(
      treatmentFor({ index: 3, confidence: 0.3 }, { ...policy, full: "label" }),
    ).toBe("label");
    expect(treatmentFor({ index: 1, confidence: 0.3 }, policy)).toBe("none");
  });

  it("levels above 'full' (future checkpoints) fall into the full bucket", () => {
    expect(levelKeyFor(5)).toBe("full");
    expect(treatmentFor({ index: 5, confidence: 0.9 }, policy)).toBe("hide");
  });
});

describe("policy persistence", () => {
  it("defaults everything to a quiet label", () => {
    expect(getAiLensPolicy()).toEqual(DEFAULT_AI_POLICY);
    expect(DEFAULT_AI_POLICY.full).toBe("label");
  });

  it("persists partial patches and survives junk values", () => {
    expect(setAiLensPolicy({ full: "collapse" })).toMatchObject({
      full: "collapse",
      moderate: "label",
    });
    expect(getAiLensPolicy().full).toBe("collapse");
    setAiLensPolicy({ full: "definitely-not-a-treatment" as never });
    expect(getAiLensPolicy().full).toBe("label"); // fell back to default
  });
});

describe("chip presentation", () => {
  it("labels stay short and non-accusatory; humans get no chip", () => {
    expect(chipLabelFor(0)).toBeNull();
    expect(chipLabelFor(1)).toBe("lightly AI");
    expect(chipLabelFor(2)).toBe("AI-assisted");
    expect(chipLabelFor(3)).toBe("AI-written");
  });

  it("colors ramp with the level", () => {
    expect(chipColorFor(2)).not.toBe(chipColorFor(3));
  });
});
