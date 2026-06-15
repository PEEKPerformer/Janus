import {
  coreMlPoisoned,
  resetCoreMlFence,
  loadCoreMlEngine,
  coreMlLoadFail,
} from "../coremlEngine";

/**
 * The crash-fence recovery contract that the "Retry on Neural Engine" button
 * depends on. The native module is absent under Jest (requireNativeModule
 * throws), so no real compile happens — but the fence itself is pure MMKV
 * logic and recovery without a re-download is exactly what we need to prove.
 */
describe("Core ML crash-fence", () => {
  beforeEach(() => resetCoreMlFence());

  it("starts unpoisoned and reset keeps it that way", () => {
    expect(coreMlPoisoned()).toBe(false);
    resetCoreMlFence();
    expect(coreMlPoisoned()).toBe(false);
  });

  it("module absent ⇒ null, and NOT mislabeled as a poisoned fence", async () => {
    const engine = await loadCoreMlEngine("/tmp/pkg", "key", 1);
    expect(engine).toBeNull();
    // The skip reason must distinguish "no native module" (module-missing,
    // handled upstream) from a latched crash-fence — they imply different UX.
    expect(coreMlLoadFail()).not.toBe("poisoned");
  });
});
