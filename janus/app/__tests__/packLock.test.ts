import {
  beginPacking,
  endPacking,
  reportPackProgress,
  getPackState,
  isPackingNow,
  subscribePack,
  __resetPackLock,
} from "../packLock";
import { buildPackScope } from "../packer";
import { DEFAULT_PACK_PREFS } from "../packPrefs";

afterEach(() => __resetPackLock());

describe("packLock store", () => {
  it("is a single slot: the second claimer loses until released", () => {
    expect(isPackingNow()).toBe(false);
    expect(beginPacking("manual")).toBe(true);
    expect(getPackState().source).toBe("manual");
    expect(beginPacking("background")).toBe(false); // already held
    endPacking();
    expect(isPackingNow()).toBe(false);
    expect(beginPacking("background")).toBe(true); // free again
  });

  it("notifies subscribers on begin / progress / end, with stable refs", () => {
    const seen: number[] = [];
    const unsub = subscribePack(() => seen.push(1));
    const a = getPackState();
    expect(getPackState()).toBe(a); // stable while idle (useSyncExternalStore needs this)
    beginPacking("background");
    reportPackProgress({ phase: "pack", done: 1, total: 4, title: "x" } as any);
    endPacking();
    expect(seen.length).toBe(3);
    unsub();
  });

  it("ignores progress reports when nothing is packing", () => {
    reportPackProgress({ phase: "pack", done: 1, total: 2, title: "y" } as any);
    expect(getPackState().progress).toBeNull();
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
