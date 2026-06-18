import type { PackProgress } from "./packer";

/**
 * The process-wide packing state — a single-slot lock plus an observable
 * snapshot. Packing is a heavy, network-bound job; the manual Plane Mode button
 * and the background refresher must never run one on top of the other (double
 * the requests = the rate-limit bracket the app works to avoid). First caller
 * wins; the other no-ops.
 *
 * It's observable (not just a boolean) so the UI can reflect a pack started by
 * EITHER source — otherwise a background refresh is invisible on the screen and
 * the manual button looks dead while the lock is held. `source` lets the UI tell
 * "you started this" (a full progress takeover) from "this is the automatic one"
 * (a quiet banner).
 */
export type PackSource = "manual" | "background";

export interface PackState {
  packing: boolean;
  progress: PackProgress | null;
  source: PackSource | null;
}

const IDLE: PackState = { packing: false, progress: null, source: null };
let state: PackState = IDLE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Claim the pack slot. Returns false if a pack is already running. */
export function beginPacking(source: PackSource): boolean {
  if (state.packing) return false;
  state = { packing: true, progress: null, source };
  emit();
  return true;
}

export function reportPackProgress(progress: PackProgress | null): void {
  if (!state.packing) return;
  state = { ...state, progress };
  emit();
}

export function endPacking(): void {
  if (state === IDLE) return;
  state = IDLE;
  emit();
}

export function getPackState(): PackState {
  return state;
}

export function isPackingNow(): boolean {
  return state.packing;
}

export function subscribePack(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. */
export function __resetPackLock(): void {
  state = IDLE;
  listeners.clear();
}
