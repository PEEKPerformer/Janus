import type { PackManifest } from "./offlinePack";
import type { PackAutoRefresh } from "./packPrefs";

/**
 * When a pack counts as "stale" enough to auto-refresh. Long enough that opening
 * Plane Mode twice in an afternoon won't burn data re-packing something fresh,
 * short enough that an overnight-old pack gets renewed before a morning flight.
 */
export const PACK_STALE_MS = 6 * 60 * 60 * 1000; // 6h

export function packAgeMs(manifest: PackManifest | null, now: number): number {
  if (!manifest || !manifest.packedAt) return Infinity;
  return now - manifest.packedAt;
}

export function isPackStale(
  manifest: PackManifest | null,
  now: number,
  staleMs = PACK_STALE_MS,
): boolean {
  return packAgeMs(manifest, now) > staleMs;
}

/**
 * Whether to silently kick off an auto re-pack right now. Deliberately
 * conservative: only refreshes an EXISTING pack (never conjures one unprompted),
 * never while offline or already packing, and only once it's actually stale.
 */
export function shouldAutoRefresh(args: {
  mode: PackAutoRefresh;
  manifest: PackManifest | null;
  now: number;
  online: boolean;
  packing: boolean;
  staleMs?: number;
}): boolean {
  const { mode, manifest, now, online, packing, staleMs } = args;
  if (mode === "off") return false;
  if (!online || packing) return false;
  // Only refresh a pack that exists and has content — don't auto-build from nothing.
  if (!manifest || !manifest.packedAt || manifest.items.length === 0)
    return false;
  return isPackStale(manifest, now, staleMs);
}
