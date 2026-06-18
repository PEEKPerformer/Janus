/**
 * A process-wide "a pack is running" flag. Packing is a heavy, network-bound
 * operation; the manual Plane Mode button and the background refresher must
 * never run one on top of the other (double the requests = the rate-limit
 * bracket the app works hard to avoid). First caller wins; the other no-ops.
 */
let packing = false;

/** Try to claim the pack slot. Returns false if a pack is already running. */
export function acquirePackLock(): boolean {
  if (packing) return false;
  packing = true;
  return true;
}

export function releasePackLock(): void {
  packing = false;
}

export function isPackingNow(): boolean {
  return packing;
}

/** Test-only reset. */
export function __resetPackLock(): void {
  packing = false;
}
