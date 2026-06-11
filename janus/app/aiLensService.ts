import { detectAi, type AiLensResult } from "./aiLens";
import { engineAvailable, loadPangramEngine } from "./pangramEngine";
import { createPangramFs, type PangramFs } from "./pangramFs";
import { getPangramState, PANGRAM_FILES } from "./pangramModel";
import { createTokenizer, type PangramTokenizer } from "./pangramTokenizer";

/**
 * The one-call surface the UI uses: is AI Lens usable right now, and what
 * does it say about this text? Tokenizer and ONNX session are built lazily
 * on first check and reused after.
 */

let tokenizer: PangramTokenizer | null = null;
let fsInstance: PangramFs | null = null;

const fs = () => (fsInstance ??= createPangramFs());

export function aiLensStatus():
  | "ready"
  | "engine-missing" // model prepared, but this build lacks the ORT pod/graph
  | "not-installed" {
  const state = getPangramState();
  if (state.phase !== "ready") return "not-installed";
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
