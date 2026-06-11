import type { PangramEngine } from "./aiLens";

/**
 * ONNX Runtime engine for the Open Pangram graph. The runtime is a native
 * module, absent in Jest and in builds without the pod — so it's resolved
 * lazily and absence degrades to "engine unavailable" rather than a crash.
 *
 * The graph (scripts/export_pangram_graph.py) takes int64 `input_ids` and
 * `attention_mask` [batch, seq] and returns `logits` [batch, numLabels].
 * Windows run one at a time: batching 512-token windows multiplies peak
 * memory, and a 1.4 GB fp32 model already lives close to the jetsam line.
 */

type Ort = typeof import("onnxruntime-react-native");

let ort: Ort | null | undefined;
function loadOrt(): Ort | null {
  if (ort !== undefined) return ort;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ort = require("onnxruntime-react-native") as Ort;
  } catch {
    ort = null;
  }
  return ort;
}

export function engineAvailable(): boolean {
  return loadOrt() !== null;
}

let session: import("onnxruntime-react-native").InferenceSession | null = null;
let sessionPath: string | null = null;

/** Load (or reuse) a session over the rehydrated graph at `graphPath`. */
export async function loadPangramEngine(
  graphPath: string,
): Promise<PangramEngine | null> {
  const rt = loadOrt();
  if (!rt) return null;
  if (!session || sessionPath !== graphPath) {
    await unloadPangramEngine();
    session = await rt.InferenceSession.create(graphPath);
    sessionPath = graphPath;
  }
  const live = session;
  return {
    async classify(windows) {
      const out: number[][] = [];
      for (const ids of windows) {
        const seq = ids.length;
        const inputIds = new BigInt64Array(seq);
        const mask = new BigInt64Array(seq);
        for (let i = 0; i < seq; i++) {
          inputIds[i] = BigInt(ids[i]);
          mask[i] = 1n;
        }
        const feeds = {
          input_ids: new rt.Tensor("int64", inputIds, [1, seq]),
          attention_mask: new rt.Tensor("int64", mask, [1, seq]),
        };
        const result = await live.run(feeds);
        const logits = result.logits;
        if (!logits) throw new Error("graph output 'logits' missing");
        out.push(Array.from(logits.data as Float32Array));
      }
      return out;
    },
  };
}

/** Free the session (the model is large; Settings' delete calls this). */
export async function unloadPangramEngine(): Promise<void> {
  try {
    await session?.release();
  } catch {
    /* best-effort */
  }
  session = null;
  sessionPath = null;
}
