import {
  chipColorFor,
  chipLabelFor,
  maybeDefaultAutoForAne,
  CONFIDENCE_FLOOR,
  DEFAULT_AI_POLICY,
  getAiLensPolicy,
  levelKeyFor,
  migrateAiLensPolicy,
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

  it("persists scan depths from the allowed sets only", () => {
    expect(getAiLensPolicy()).toMatchObject({ scanCap: 30, autoCap: 12 });
    setAiLensPolicy({ scanCap: 60, autoCap: 6 });
    expect(getAiLensPolicy()).toMatchObject({ scanCap: 60, autoCap: 6 });
    setAiLensPolicy({ scanCap: 9999 as never, autoCap: -1 as never });
    expect(getAiLensPolicy()).toMatchObject({ scanCap: 30, autoCap: 12 });
  });

  it("persists the auto mode, defaults to ahead, rejects junk", () => {
    expect(getAiLensPolicy().auto).toBe("ahead");
    expect(setAiLensPolicy({ auto: "threads" }).auto).toBe("threads");
    expect(getAiLensPolicy().auto).toBe("threads");
    setAiLensPolicy({ auto: "everything!!" as never });
    expect(getAiLensPolicy().auto).toBe("ahead");
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

describe("maybeDefaultAutoForAne (one-shot upgrade to the real default)", () => {
  it("bumps any lower tier to ahead exactly once on first ANE proof", () => {
    setAiLensPolicy({ auto: "threads" }); // chosen back when checks were slow
    expect(maybeDefaultAutoForAne().auto).toBe("ahead");
    // Anything chosen AFTER the bump sticks forever.
    setAiLensPolicy({ auto: "off" });
    expect(maybeDefaultAutoForAne().auto).toBe("off");
  });
});

describe("visibility toggles", () => {
  it("persists showActivity / showHuman with sane defaults", () => {
    // Both on by default: a relied-on detector marks what it judged (human /
    // too-short) so a clean comment reliably means "not judged yet".
    expect(getAiLensPolicy()).toMatchObject({
      showActivity: true,
      showHuman: true,
    });
    setAiLensPolicy({ showHuman: false, showActivity: false });
    expect(getAiLensPolicy()).toMatchObject({
      showActivity: false,
      showHuman: false,
    });
  });

  it("migration flips an existing opted-out install on, once, then respects re-opt-out", () => {
    // An install from before the new default: persisted with showHuman off.
    setAiLensPolicy({ showHuman: false });
    migrateAiLensPolicy();
    expect(getAiLensPolicy().showHuman).toBe(true);
    // Idempotent: a deliberate later opt-out must stick across re-runs.
    setAiLensPolicy({ showHuman: false });
    migrateAiLensPolicy();
    expect(getAiLensPolicy().showHuman).toBe(false);
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

  it("opt-in human chip: green and labeled", () => {
    expect(chipLabelFor(0, true)).toBe("human");
    expect(chipColorFor(0)).toBe("#5bb98c");
  });
});
