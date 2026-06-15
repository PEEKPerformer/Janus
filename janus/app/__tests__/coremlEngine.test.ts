import {
  coreMlPoisoned,
  coreMlCrashCount,
  resetCoreMlFence,
  loadCoreMlEngine,
  coreMlLoadFail,
} from "../coremlEngine";

/**
 * The crash budget and its recovery. The native module is absent under Jest
 * (requireNativeModule throws), so no real compile happens — but the budget
 * is pure MMKV logic: it must self-heal a transient failure yet stop thrashing
 * on a deterministic one, and recover without a re-download.
 */
describe("Core ML crash budget", () => {
  // Reach the same MMKV-backed fence the module uses (id janus.coreml.v1).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createMMKV } = require("react-native-mmkv");
  const fence = createMMKV({ id: "janus.coreml.v1" });

  beforeEach(() => resetCoreMlFence());

  it("starts unpoisoned with a zero crash count", () => {
    expect(coreMlPoisoned()).toBe(false);
    expect(coreMlCrashCount()).toBe(0);
  });

  it("tolerates one native crash, gives up on the second (bounded, no thrash)", () => {
    // Simulate a compile that set in-flight and died natively (process gone).
    fence.set("compileInFlight", "1");
    expect(coreMlPoisoned()).toBe(false); // 1 crash — still within budget
    expect(coreMlCrashCount()).toBe(1);

    // The in-flight flag was consumed, so re-checking this session never
    // double-counts the same crash.
    expect(coreMlCrashCount()).toBe(1);

    // A second crash exhausts the budget.
    fence.set("compileInFlight", "1");
    expect(coreMlPoisoned()).toBe(true);
    expect(coreMlCrashCount()).toBe(2);
  });

  it("resetCoreMlFence clears the budget — recovery without a re-download", () => {
    fence.set("compileCrashes", "2");
    expect(coreMlPoisoned()).toBe(true);
    resetCoreMlFence();
    expect(coreMlPoisoned()).toBe(false);
    expect(coreMlCrashCount()).toBe(0);
  });

  it("ignores the legacy binary poison flag (upgrade grants a fresh budget)", () => {
    fence.set("poisoned", "1"); // pre-budget scheme
    expect(coreMlPoisoned()).toBe(false);
  });

  it("module absent ⇒ null, not mislabeled as a spent budget", async () => {
    const engine = await loadCoreMlEngine("/tmp/pkg", "key", 1);
    expect(engine).toBeNull();
    expect(coreMlLoadFail()).not.toBe("poisoned");
  });
});
