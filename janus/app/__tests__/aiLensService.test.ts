import { aiLensStatus } from "../aiLensService";
import { MANIFEST } from "../pangramGraphAsset";
import { getPangramState, setPangramState } from "../pangramModel";

describe("aiLensStatus engine-format migration", () => {
  it("flips a ready install with a stale data layout to a re-download error", () => {
    expect(MANIFEST).not.toBeNull();
    setPangramState({
      phase: "ready",
      sha: "abc",
      numLabels: 4,
      dataBytes: 123, // built by an older build (e.g. the fp32 layout)
    });
    expect(aiLensStatus()).toBe("not-installed");
    expect(getPangramState()).toMatchObject({ phase: "error" });
    expect(getPangramState().error).toMatch(/int8/);
  });

  it("accepts an install matching the bundled manifest", () => {
    setPangramState({
      phase: "ready",
      sha: "abc",
      numLabels: 4,
      dataBytes: MANIFEST!.dataTotalBytes,
    });
    // ready or engine-missing depending on the mocked runtime — never an error.
    expect(["ready", "engine-missing"]).toContain(aiLensStatus());
    expect(getPangramState().phase).toBe("ready");
  });
});
