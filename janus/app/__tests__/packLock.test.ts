import {
  acquirePackLock,
  releasePackLock,
  isPackingNow,
  __resetPackLock,
} from "../packLock";
import { buildPackScope } from "../packer";
import { DEFAULT_PACK_PREFS } from "../packPrefs";

afterEach(() => __resetPackLock());

describe("packLock", () => {
  it("is a single slot: the second caller loses until released", () => {
    expect(isPackingNow()).toBe(false);
    expect(acquirePackLock()).toBe(true);
    expect(isPackingNow()).toBe(true);
    expect(acquirePackLock()).toBe(false); // already held — manual vs background
    releasePackLock();
    expect(isPackingNow()).toBe(false);
    expect(acquirePackLock()).toBe(true); // free again
  });
});

describe("buildPackScope", () => {
  it("mirrors the prefs and gates aiScan on the model being ready", () => {
    const prefs = { ...DEFAULT_PACK_PREFS, aiScan: true, includeImages: false };
    expect(buildPackScope(prefs, false).aiScan).toBe(false); // model not ready
    expect(buildPackScope(prefs, true).aiScan).toBe(true);
    expect(buildPackScope(prefs, true).includeImages).toBe(false);
    expect(buildPackScope(prefs, true).feedSnapshot).toBe(prefs.feedSnapshot);
  });
});
