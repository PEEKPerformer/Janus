import {
  PACK_STALE_MS,
  isPackStale,
  packAgeMs,
  shouldAutoRefresh,
} from "../packAutoRefresh";
import type { PackManifest } from "../offlinePack";

const NOW = 1_000_000_000_000;
const manifest = (ageMs: number, items = 1): PackManifest => ({
  packedAt: NOW - ageMs,
  items: Array.from({ length: items }, (_v, i) => ({ id: `p${i}` })) as any,
});

describe("pack age + staleness", () => {
  it("treats a missing manifest as infinitely old", () => {
    expect(packAgeMs(null, NOW)).toBe(Infinity);
    expect(isPackStale(null, NOW)).toBe(true);
  });

  it("is stale only past the threshold", () => {
    expect(isPackStale(manifest(PACK_STALE_MS - 1000), NOW)).toBe(false);
    expect(isPackStale(manifest(PACK_STALE_MS + 1000), NOW)).toBe(true);
  });
});

describe("shouldAutoRefresh", () => {
  const base = {
    mode: "onOpen" as const,
    manifest: manifest(PACK_STALE_MS + 1000),
    now: NOW,
    online: true,
    packing: false,
  };

  it("refreshes a stale pack when opted in, online, idle", () => {
    expect(shouldAutoRefresh(base)).toBe(true);
  });

  it("never refreshes when the mode is off", () => {
    expect(shouldAutoRefresh({ ...base, mode: "off" })).toBe(false);
  });

  it("holds off when offline or already packing", () => {
    expect(shouldAutoRefresh({ ...base, online: false })).toBe(false);
    expect(shouldAutoRefresh({ ...base, packing: true })).toBe(false);
  });

  it("won't conjure a pack from nothing (no/empty manifest)", () => {
    expect(shouldAutoRefresh({ ...base, manifest: null })).toBe(false);
    expect(shouldAutoRefresh({ ...base, manifest: manifest(99e9, 0) })).toBe(
      false,
    );
  });

  it("leaves a fresh pack alone", () => {
    expect(
      shouldAutoRefresh({ ...base, manifest: manifest(PACK_STALE_MS - 1000) }),
    ).toBe(false);
  });
});
