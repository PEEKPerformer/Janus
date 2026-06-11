import { detectAi, type AiLensResult } from "./aiLens";
import { MANIFEST } from "./pangramGraphAsset";
import { engineAvailable, loadPangramEngine } from "./pangramEngine";
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

export async function checkTextWithAiLens(text: string): Promise<AiLensResult> {
  const state = getPangramState();
  if (state.phase !== "ready")
    throw new Error("AI Lens model isn't installed yet");
  if (!tokenizer)
    tokenizer = createTokenizer(
      await fs().readText(PANGRAM_FILES.vocab),
      await fs().readText(PANGRAM_FILES.merges),
    );
  const engine = await loadPangramEngine(
    fs().path(PANGRAM_FILES.graph),
    tokenizer.padId,
  );
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
    if (getPangramState().phase !== "ready") return;
    if (!tokenizer)
      tokenizer = createTokenizer(
        await fs().readText(PANGRAM_FILES.vocab),
        await fs().readText(PANGRAM_FILES.merges),
      );
    const engine = await loadPangramEngine(
      fs().path(PANGRAM_FILES.graph),
      tokenizer.padId,
    );
    // Bypass the detector (which would refuse short text before the engine
    // ever ran) — one micro-window heats the kernels directly.
    await engine?.classify([
      [tokenizer.bosId, ...tokenizer.encode("warm up"), tokenizer.eosId],
    ]);
  } catch {
    /* warmup is opportunistic */
  }
}
