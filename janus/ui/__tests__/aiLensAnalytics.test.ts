import { confidenceBucket } from "../aiLensAnalytics";

describe("confidenceBucket", () => {
  it("coarsens confidence into content-free bands", () => {
    expect(confidenceBucket({ confidence: 0.4 })).toBe("<60");
    expect(confidenceBucket({ confidence: 0.6 })).toBe("60-80");
    expect(confidenceBucket({ confidence: 0.79 })).toBe("60-80");
    expect(confidenceBucket({ confidence: 0.8 })).toBe("80-95");
    expect(confidenceBucket({ confidence: 0.949 })).toBe("80-95");
    expect(confidenceBucket({ confidence: 0.95 })).toBe("95+");
    expect(confidenceBucket({ confidence: 1 })).toBe("95+");
  });
});
