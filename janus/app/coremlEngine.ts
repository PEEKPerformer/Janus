import { createMMKV } from "react-native-mmkv";

import type { PangramEngine } from "./aiLens";
import { maybeDefaultAutoForAne } from "./aiLensPolicy";
import { reportBackend } from "./pangramEngine";

/**
 * The Neural Engine binding. Native side (modules/pangram-coreml) compiles
 * the rehydrated .mlpackage once and serves fp16 predictions on the ANE —
 * ~90ms per window on the dev Mac vs 460ms int8 CPU.
 *
 * Two safety properties:
 * - the native module is optional (absent in Jest, sim builds, Android);
 *   absence just means the ORT int8 engine keeps the job.
 * - the FIRST compile attempt is crash-fenced: a flag is set before and
 *   cleared after, so if Core ML aborts natively (the failure mode that
 *   killed the ORT Core ML EP), the next launch sees the stale flag and
 *   permanently retreats to the CPU engine instead of crash-looping.
 */

const SEQ = 512; // the MLProgram is compiled for a static [1, 512] shape

interface NativeCoreML {
  compileAndLoad(packagePath: string, cacheKey: string): Promise<boolean>;
  classify(ids: number[], mask: number[]): Promise<number[]>;
  unload(): void;
}

let native: NativeCoreML | null | undefined;
function loadNative(): NativeCoreML | null {
  if (native !== undefined) return native;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require("expo-modules-core");
    native = requireNativeModule("PangramCoreML") as NativeCoreML;
  } catch {
    native = null;
  }
  return native;
}

export function coreMlAvailable(): boolean {
  return loadNative() !== null;
}

const fence = createMMKV({ id: "janus.coreml.v1" });
const IN_FLIGHT = "compileInFlight";
const LEGACY_POISONED = "poisoned"; // pre-budget binary flag — now ignored
const CRASHES = "compileCrashes";
/**
 * How many failed compiles we tolerate before giving up the ANE for good.
 * Each native crash costs one bad launch (the abort kills the process during
 * the +2.5s warmup), so this is deliberately small: it self-heals a single
 * transient failure (memory pressure on a 711 MB fp16 compile) but stops
 * thrashing fast on a genuinely uncompilable model. Reset to 0 on success.
 */
const MAX_CRASHES = 2;

/**
 * Detect-and-account a crash from a PRIOR attempt: a stale in-flight flag
 * means the last compile set it and never cleared it — i.e. the process died
 * natively mid-compile. Count it once (consuming the flag so a second call
 * this session doesn't double-count) and report the running total.
 */
function accountPriorCrash(): number {
  let crashes = Number(fence.getString(CRASHES) ?? "0") || 0;
  if (fence.getString(IN_FLIGHT) === "1") {
    crashes += 1;
    fence.set(CRASHES, String(crashes));
    fence.remove(IN_FLIGHT);
  }
  return crashes;
}

/** Running tally of failed compiles (crashes + catchable failures). */
export function coreMlCrashCount(): number {
  try {
    return accountPriorCrash();
  } catch {
    return MAX_CRASHES;
  }
}

/** True once the crash budget is spent — the ANE is given up until a reset. */
export function coreMlPoisoned(): boolean {
  try {
    return accountPriorCrash() >= MAX_CRASHES;
  } catch {
    return true;
  }
}

/** Record a failed compile against the budget (catchable failures count too,
 *  so a deterministic non-crashing failure can't retry every launch forever). */
function bumpCrashes(): void {
  try {
    const n = (Number(fence.getString(CRASHES) ?? "0") || 0) + 1;
    fence.set(CRASHES, String(n));
  } catch {
    /* best-effort */
  }
}

/** Clear the budget — auto on a successful compile, manual via Retry/re-install. */
export function resetCoreMlFence(): void {
  try {
    fence.remove(IN_FLIGHT);
    fence.remove(CRASHES);
    fence.remove(LEGACY_POISONED);
  } catch {
    /* best-effort */
  }
}

let engine: PangramEngine | null = null;
let loadedKey: string | null = null;

/**
 * Why the last loadCoreMlEngine() returned null, for telemetry:
 *   - "poisoned"  : the crash budget is spent (MAX_CRASHES failed compiles) —
 *                   we no longer attempt until a reset
 *   - "load-null" : we attempted a fresh compile this session and it failed
 *                   (graceful native error), charging one to the budget
 *   - null        : the ANE loaded fine
 */
export type CoreMlLoadFail = "poisoned" | "load-null";
let lastLoadFail: CoreMlLoadFail | null = null;

export function coreMlLoadFail(): CoreMlLoadFail | null {
  return lastLoadFail;
}

/**
 * Compile (cached) + load the package and return the engine, or null when
 * the module is absent or Core ML previously proved fatal here.
 */
export async function loadCoreMlEngine(
  packagePath: string,
  cacheKey: string,
  padId = 1,
): Promise<PangramEngine | null> {
  const nat = loadNative();
  if (!nat) return null; // module absent — resolveEngine reports module-missing
  if (coreMlPoisoned()) {
    lastLoadFail = "poisoned";
    return null;
  }
  if (engine && loadedKey === cacheKey) return engine;
  try {
    fence.set(IN_FLIGHT, "1");
    await nat.compileAndLoad(packagePath, cacheKey);
  } catch {
    // Catchable failure — no native crash, so the finally clears IN_FLIGHT and
    // accountPriorCrash won't see it; charge the budget explicitly here so a
    // deterministic non-crashing failure still gives up after MAX_CRASHES.
    lastLoadFail = "load-null";
    bumpCrashes();
    return null; // graceful native error — ORT keeps the job
  } finally {
    try {
      fence.remove(IN_FLIGHT);
    } catch {
      /* best-effort */
    }
  }
  loadedKey = cacheKey;
  lastLoadFail = null;
  fence.set(CRASHES, "0"); // a clean compile clears the budget for next time
  reportBackend("Neural Engine");
  // 63ms/check is effectively free — checking everything becomes the
  // default the first time the ANE proves itself (one-shot, respects any
  // explicit user choice).
  maybeDefaultAutoForAne();
  engine = {
    async classify(windows) {
      const out: number[][] = [];
      for (const rawIds of windows) {
        // Static shape: every window pads to the full 512 — on the ANE the
        // cost is flat (~90ms) regardless, so buckets buy nothing here.
        const ids = rawIds.slice(0, SEQ);
        const mask = new Array<number>(SEQ).fill(0);
        for (let i = 0; i < ids.length; i++) mask[i] = 1;
        while (ids.length < SEQ) ids.push(padId);
        out.push(await nat.classify(ids, mask));
      }
      return out;
    },
  };
  return engine;
}

export function unloadCoreMlEngine(): void {
  try {
    loadNative()?.unload();
  } catch {
    /* best-effort */
  }
  engine = null;
  loadedKey = null;
}
