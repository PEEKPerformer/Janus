# AI Lens — on-device Open Pangram

AI Lens answers "was this written by AI?" about any post or comment, entirely
on-device, using [Open Pangram](https://huggingface.co/collections/pangram/open-pangram)
— Pangram Labs' open-weights release of their EditLens (ICLR 2026) detector.
No text leaves the phone; it works offline, including inside a Plane Mode pack.

## The model

Two checkpoints exist in the collection. Janus targets
**`pangram/editlens_roberta-large`**:

| | `editlens_roberta-large` | `editlens_Llama-3.2-3B` |
|---|---|---|
| What's in the repo | **full merged** 355M-param `RobertaForSequenceClassification` (F32 safetensors, 1.42 GB) + tokenizer | 66 MB PEFT **adapter only**, on top of `meta-llama/Llama-3.2-3B` (itself separately Meta-gated) |
| On-device fit | ✔ encoder, 512-token context, phone-sized | ✘ needs the Meta base + adapter merge |

Output: K logits = levels of AI pervasiveness (Human-written → Lightly →
Moderately → Fully AI-generated; exact labels read from the checkpoint's
`config.json` at install, never assumed). English only. License
**CC BY-NC-SA 4.0, non-commercial**, gated manually on the Hub.

## Why the app ships zero model bytes

The repo is gated and non-commercial, so distribution stays between Pangram
and the user:

1. User accepts the license on huggingface.co with their own account.
2. User pastes an HF **read token** into Settings → AI Lens (kept in the
   keychain — `pangramToken.ts`).
3. The app downloads the checkpoint straight from the Hub, revision-pinned
   (`pangramHub.ts`), and verifies it's really the RoBERTa classifier by
   parsing the safetensors header (`safetensors.ts`).

401 → "bad token", 403 → "accept the gate first" — each with user-speakable
copy (`gateMessage`).

## How inference works (the rehydration trick)

There's no PyTorch on the phone, and ONNX Runtime can't eat safetensors. The
usual answer — convert the checkpoint offline and ship it — is exactly what
the gate forbids. So Janus splits the model into the part that's public and
the part that isn't:

- **Graph** (bundled in the app): `scripts/export_pangram_graph.py` exports a
  *weight-free* ONNX graph of the RobertaForSequenceClassification
  architecture from the **public** `FacebookAI/roberta-large` — pure
  architecture, no Pangram IP — with every initializer externalized, plus a
  manifest mapping each tensor name → (offset, byte length) in the external
  data file.
- **Weights** (user-downloaded): at install time the app parses the gated
  checkpoint's safetensors header and **splices each tensor's raw F32 bytes
  into the external-data file at the manifest's offsets** — plain ranged byte
  copies (`planRehydration` in `pangramModel.ts`, streamed 8 MB at a time via
  `expo-file-system` FileHandles). Names, dtypes and sizes are validated
  before any bytes move.

The result is a normal ONNX model that `onnxruntime-react-native` loads
(`pangramEngine.ts`). Tokenization is a ~120-line byte-level BPE
(GPT-2/RoBERTa flavor) in plain TS (`pangramTokenizer.ts`) — fully unit
tested, no native tokenizer dependency.

## Detection pipeline

`aiLensService.checkTextWithAiLens(text)` → `aiLens.detectAi`:

- < 48 tokens → refused ("too short to judge fairly"); detectors are coin
  tosses on short text.
- Long text → 512-token windows (≤ 8), one forward pass each; verdict =
  argmax of the token-weighted mean distribution; the single most-AI window
  is reported separately, so a mostly-human post with one pasted-in AI
  section still surfaces ("one section reads more AI than the rest").
- Verdicts cached in MMKV by text-hash + model revision — a 355M forward
  pass never runs twice for the same text.
- Copy is deliberately non-accusatory ("Likely …"), per the in-app notice:
  signal, not proof.

## UI surfaces

- **Settings → AI Lens** (`AiLensScreen`): 3-step setup (gate → token →
  download with progress), status card, delete, license/attribution notice.
- **Threads**: "AI?" button under each comment's action row and under the
  post body once the model is installed; verdict renders inline.

## Status & next steps

Shipped and tested: the full TS layer (hub client, gate handling, downloader,
safetensors parser, BPE tokenizer, rehydration planner, detector, caching,
screens — 45 tests). The ONNX engine binding is implemented but **inert until
the graph asset is generated**:

1. On a dev machine: `pip install torch transformers onnx` then
   `python scripts/export_pangram_graph.py --num-labels-from-hub`
   (needs `HF_TOKEN` with the gate accepted; falls back to `--num-labels 4`).
2. Point `janus/app/pangramGraphAsset.ts` at the generated assets (two-line
   change documented in the file). `metro.config.js` already bundles `.onnx`.
3. Rebuild the ipa. A checkpoint downloaded before the graph existed
   finishes installing without re-downloading (`preparePangram`).
4. Validate ONNX initializer names against the manifest on first device run —
   `planRehydration` fails loudly (with the offending tensor name) if the
   exporter named things differently.

Future: int8 quantization (manifest-driven, scales computable on-device) to
cut the 1.4 GB fp32 footprint ~4×; Core ML execution provider; batch
prefetch ("scan this thread").
