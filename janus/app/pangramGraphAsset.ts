import type { RehydrationManifest } from "./pangramModel";
import type { PangramFs } from "./pangramFs";

/**
 * Bundled ONNX graph for the Open Pangram detector.
 *
 * scripts/export_pangram_graph.py exports a *weight-free* graph of the
 * public roberta-large sequence-classification architecture (no Pangram IP)
 * plus a manifest mapping each external tensor into pangram_weights.data.
 * Run it once on a dev machine, then flip the two constants below to the
 * generated requires:
 *
 *   export const GRAPH_MODULE = require("../../assets/models/pangram_graph.onnx");
 *   export const MANIFEST: RehydrationManifest | null =
 *     require("../../assets/models/pangram_manifest.json");
 *
 * (metro.config.js already treats .onnx as an asset.) Until then both are
 * null and the feature degrades gracefully: the checkpoint downloads and
 * verifies, but the engine reports "not available in this build".
 */

export const GRAPH_MODULE: number | null = null;
export const MANIFEST: RehydrationManifest | null = null;

/**
 * Stage the bundled graph into the pangram dir and hand back the manifest.
 * Resolves null when this build doesn't carry the asset.
 */
export async function loadGraphAsset(
  fs: PangramFs,
): Promise<{ manifest: RehydrationManifest } | null> {
  if (GRAPH_MODULE == null || MANIFEST == null) return null;
  // Lazy import: expo-asset only matters once the asset actually exists.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Asset } = require("expo-asset") as typeof import("expo-asset");
  const asset = Asset.fromModule(GRAPH_MODULE);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("graph asset has no local uri");
  await fs.importFile(asset.localUri, "pangram_graph.onnx");
  return { manifest: MANIFEST };
}
