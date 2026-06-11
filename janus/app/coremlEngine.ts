import { createMMKV } from "react-native-mmkv";

import type { PangramEngine } from "./aiLens";
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
const POISONED = "poisoned";

export function coreMlPoisoned(): boolean {
  try {
    // A stale in-flight flag means the last compile attempt died natively.
    if (fence.getString(IN_FLIGHT) === "1" && fence.getString(POISONED) !== "0")
      fence.set(POISONED, "1");
    return fence.getString(POISONED) === "1";
  } catch {
    return true;
  }
}

/** Test/maintenance hook: clear the fence (e.g. after a model re-install). */
export function resetCoreMlFence(): void {
  try {
    fence.remove(IN_FLIGHT);
    fence.remove(POISONED);
  } catch {
    /* best-effort */
  }
}

let engine: PangramEngine | null = null;
let loadedKey: string | null = null;

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
  if (!nat || coreMlPoisoned()) return null;
  if (engine && loadedKey === cacheKey) return engine;
  try {
    fence.set(IN_FLIGHT, "1");
    await nat.compileAndLoad(packagePath, cacheKey);
  } catch {
    return null; // graceful native error — ORT keeps the job
  } finally {
    try {
      fence.remove(IN_FLIGHT);
    } catch {
      /* best-effort */
    }
  }
  loadedKey = cacheKey;
  reportBackend("Neural Engine");
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
