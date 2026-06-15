import { detectAi, type AiLensResult, type PangramEngine } from "./aiLens";
import { COREML_MANIFEST } from "./coremlAssets";
import { COREML_PKG_DIR } from "./coremlBuild";
import {
  coreMlAvailable,
  coreMlLoadFail,
  loadCoreMlEngine,
} from "./coremlEngine";
import { MANIFEST } from "./pangramGraphAsset";
import {
  engineAvailable,
  engineBackend,
  loadPangramEngine,
} from "./pangramEngine";
import { track } from "./analytics";
import { createPangramFs, type PangramFs } from "./pangramFs";
import {
  getPangramState,
  setPangramState,
  PANGRAM_FILES,
  type PangramState,
} from "./pangramModel";
import { createTokenizer, type PangramTokenizer } from "./pangramTokenizer";

/**
 * The one-call surface the UI uses: is AI Lens usable right now, and what
 * does it say about this text? Tokenizer and ONNX session are built lazily
 * on first check and reused after.
 */

let tokenizer: PangramTokenizer | null = null;
let fsInstance: PangramFs | null = null;

const fs = () => (fsInstance ??= createPangramFs());

/** The bundled graph's data layout must match what this install built —
 * an app update that changes the engine format (fp32 -> int8) makes the old
 * data file unloadable, and the checkpoint was deleted after rehydration. */
function dataCompatible(state: PangramState): boolean {
  return MANIFEST == null || state.dataBytes === MANIFEST.dataTotalBytes;
}

export function aiLensStatus():
  | "ready"
  | "engine-missing" // model prepared, but this build lacks the ORT pod/graph
  | "not-installed" {
  const state = getPangramState();
  if (state.phase !== "ready") return "not-installed";
  if (!dataCompatible(state)) {
    setPangramState({
      phase: "error",
      error:
        "This update upgraded the AI engine (int8 — about 3× faster, a third the size). Re-download the model below; your token is saved.",
    });
    return "not-installed";
  }
  return engineAvailable() ? "ready" : "engine-missing";
}

/**
 * Why the Apple Neural Engine path was bypassed this session — one of the
 * four silent fallbacks to XNNPACK. Emitted with the ai_lens_ready event so a
 * "lost the Neural Engine" regression is diagnosable from the fleet instead of
 * by reading a release build's MMKV:
 *   - "no-manifest"    : the Core ML asset wasn't bundled in this build
 *   - "module-missing" : the PangramCoreML native module didn't link (e.g. sim)
 *   - "not-built"      : install never recorded a Core ML weight size
 *   - "size-mismatch"  : recorded weight size != bundled manifest's
 *   - "poisoned"       : crash-fence latched from a PAST native compile crash
 *   - "load-null"      : a fresh compile attempt failed (catchable) this session
 *   - "none"           : ANE engine loaded — running on the Neural Engine
 */
export type CoreMlSkip =
  | "no-manifest"
  | "module-missing"
  | "not-built"
  | "size-mismatch"
  | "poisoned"
  | "load-null"
  | "none";

let readyReported = false;

/** Best engine first: ANE (when this install built the Core ML package and
 * the module is present and unpoisoned), else the ORT int8 session. */
async function resolveEngine(
  state: PangramState,
  padId: number,
): Promise<PangramEngine | null> {
  let skip: CoreMlSkip;
  let engine: PangramEngine | null = null;
  if (!COREML_MANIFEST) skip = "no-manifest";
  else if (!coreMlAvailable()) skip = "module-missing";
  else if (state.coremlBytes !== COREML_MANIFEST.weightBinSize)
    skip = state.coremlBytes == null ? "not-built" : "size-mismatch";
  else {
    engine = await loadCoreMlEngine(
      fs().path(COREML_PKG_DIR),
      `${state.coremlBytes}-${state.sha?.slice(0, 7) ?? "x"}`,
      padId,
    );
    // Distinguish a stale crash-fence (past native crash) from a fresh
    // catchable compile failure — they imply different fixes.
    skip = engine ? "none" : (coreMlLoadFail() ?? "load-null");
  }
  if (!engine)
    engine = await loadPangramEngine(fs().path(PANGRAM_FILES.graph), padId);

  // Once per session, after the backend is settled: which engine actually won,
  // and (if not the ANE) which gate sent us to XNNPACK. No content, opt-in.
  if (engine && !readyReported) {
    readyReported = true;
    track("ai_lens_ready", {
      backend: engineBackend() ?? "unknown",
      coreml_skip: skip,
      sha: state.sha?.slice(0, 7),
    });
  }
  return engine;
}

export async function checkTextWithAiLens(text: string): Promise<AiLensResult> {
  const state = getPangramState();
  if (state.phase !== "ready")
    throw new Error("AI Lens model isn't installed yet");
  if (!dataCompatible(state)) {
    // Never load the new graph against an old-format data file — that's
    // garbage-in at best and a native crash at worst.
    setPangramState({
      phase: "error",
      error:
        "This update upgraded the AI engine (int8 — about 3× faster, a third the size). Re-download the model below; your token is saved.",
    });
    throw new Error(
      "AI Lens engine was upgraded — re-download the model in Settings → AI Lens",
    );
  }
  if (!tokenizer)
    tokenizer = createTokenizer(
      await fs().readText(PANGRAM_FILES.vocab),
      await fs().readText(PANGRAM_FILES.merges),
    );
  const engine = await resolveEngine(state, tokenizer.padId);
  if (!engine)
    throw new Error("Detection engine isn't available in this build");
  return detectAi(text, {
    tokenizer,
    engine,
    labels: state.labels,
    modelSha: state.sha,
  });
}

/** Drop the lazily-built tokenizer (after uninstall). */
export function resetAiLensService(): void {
  tokenizer = null;
}

/**
 * Boot-time warmup, called when auto mode is on: build the tokenizer, load
 * the ONNX session, and push one tiny window through so the first real
 * check pays nothing and the settings card knows its backend immediately.
 * Best-effort by design — a failed warmup just means lazy loading later.
 */
export async function warmAiLens(): Promise<void> {
  try {
    if (aiLensStatus() !== "ready") return;
    if (!tokenizer)
      tokenizer = createTokenizer(
        await fs().readText(PANGRAM_FILES.vocab),
        await fs().readText(PANGRAM_FILES.merges),
      );
    const engine = await resolveEngine(getPangramState(), tokenizer.padId);
    // Bypass the detector (which would refuse short text before the engine
    // ever ran) — one micro-window heats the kernels directly.
    await engine?.classify([
      [tokenizer.bosId, ...tokenizer.encode("warm up"), tokenizer.eosId],
    ]);
  } catch {
    /* warmup is opportunistic */
  }
}
