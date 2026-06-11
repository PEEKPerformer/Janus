import type { PangramEngine } from "./aiLens";

/**
 * ONNX Runtime engine for the Open Pangram graph. The runtime is a native
 * module, absent in Jest and in builds without the pod — so it's resolved
 * lazily and absence degrades to "engine unavailable" rather than a crash.
 *
 * Execution providers are tried best-first: Core ML (ANE/GPU) → XNNPACK
 * (optimized CPU) → default CPU. Whichever session creation succeeds wins;
 * `engineBackend()` reports it so Settings can show what's actually running.
 *
 * Inputs are padded up to fixed-size buckets (64/128/256/512): Core ML
 * compiles per input shape, so without bucketing every odd comment length
 * would trigger a recompile. Padding is numerically safe — the pad tokens
 * carry attention_mask 0 and the classifier pools the <s> position.
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

const EP_CASCADE: { label: string; providers?: unknown[] }[] = [
  { label: "Core ML", providers: ["coreml"] },
  { label: "XNNPACK", providers: ["xnnpack"] },
  { label: "CPU", providers: undefined },
];

const BUCKETS = [64, 128, 256, 512];

/** Pad ids up to the next bucket (returns ids + mask of equal length). */
export function padToBucket(
  ids: number[],
  padId: number,
): { ids: number[]; mask: number[] } {
  const bucket = BUCKETS.find((b) => b >= ids.length) ?? ids.length;
  const mask = new Array<number>(bucket).fill(0);
  for (let i = 0; i < ids.length; i++) mask[i] = 1;
  const padded = ids.slice();
  while (padded.length < bucket) padded.push(padId);
  return { ids: padded, mask };
}

let session: import("onnxruntime-react-native").InferenceSession | null = null;
let sessionPath: string | null = null;
let backend: string | null = null;

/** The execution provider the live session runs on (null before first load). */
export function engineBackend(): string | null {
  return backend;
}

/** Load (or reuse) a session over the rehydrated graph at `graphPath`. */
export async function loadPangramEngine(
  graphPath: string,
  padId = 1, // RoBERTa <pad>
): Promise<PangramEngine | null> {
  const rt = loadOrt();
  if (!rt) return null;
  if (!session || sessionPath !== graphPath) {
    await unloadPangramEngine();
    for (const ep of EP_CASCADE) {
      try {
        session = await rt.InferenceSession.create(
          graphPath,
          ep.providers
            ? ({ executionProviders: ep.providers } as never)
            : undefined,
        );
        sessionPath = graphPath;
        backend = ep.label;
        break;
      } catch {
        session = null;
      }
    }
    if (!session) throw new Error("AI Lens engine failed to load the model");
  }
  const live = session;
  return {
    async classify(windows) {
      const out: number[][] = [];
      for (const rawIds of windows) {
        const { ids, mask } = padToBucket(rawIds, padId);
        const seq = ids.length;
        const inputIds = new BigInt64Array(seq);
        const maskIds = new BigInt64Array(seq);
        for (let i = 0; i < seq; i++) {
          inputIds[i] = BigInt(ids[i]);
          maskIds[i] = BigInt(mask[i]);
        }
        const feeds = {
          input_ids: new rt.Tensor("int64", inputIds, [1, seq]),
          attention_mask: new rt.Tensor("int64", maskIds, [1, seq]),
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
  backend = null;
}
