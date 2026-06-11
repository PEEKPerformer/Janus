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
  The gate step is explicit that **approval is manual on Pangram's side and
  can take days, sometimes weeks** — the token saves now, and a low-stakes
  "Check approval status" button polls the gate inline (no failed-download
  ceremony) until access opens.
- **Threads**: "AI?" button under each comment's action row and under the
  post body once the model is installed; verdict renders inline.

## The policy ladder — what a verdict *does*

The detector only labels; what the label does is the user's call, configured
per level in `aiLensPolicy.ts` and the setup screen:

| treatment | rendering |
|---|---|
| none | nothing |
| label *(default)* | a quiet chip next to the badges (amber → red ramp by level) |
| dim | chip + faded body |
| collapse ("Fold") | body folds into a reasoned stub — "Folded by AI Lens (AI-written) — show" |
| hide | a hairline stub — still one tap from visible |

Two invariants: **nothing is ever silently removed** (every veil is a tappable
stub, like a collapsed comment chain), and **uncertain verdicts never escalate
past a label** (`CONFIDENCE_FLOOR = 0.6` — auto-folding a human on a coin toss
is the failure mode the design exists to avoid). Chip taps open the full
breakdown with the on-device/non-accusatory framing.

## When judging runs (cost in the user's hands)

A 355M forward pass per window means no silent feed-wide scanning. Three
explicit tiers, all feeding the same persistent verdict cache:

1. **Manual** — the "AI?" button on any comment or post body.
2. **Scan this thread** (`threadAiScan.ts`) — one tap on the scan pill in the
   comment bar judges the highest-leverage slice (roots by score, then
   replies, capped at 30), sequential to keep peak memory sane, with live
   `12/30` progress; tap again to stop. Already-judged comments spend no
   budget.
3. **Pack-time scan** — a Plane Mode scope toggle (shown only when AI Lens is
   ready) judges each packed post body + its top 10 root comments during the
   pack, when the user has already agreed to leave the phone open and
   working. Land with chips — and your policy — already applied, offline.

`PostScreen` hydrates verdicts from the cache on thread load, so anything
judged anywhere (an earlier visit, a pack) lights up for free.

## Status — LIVE (graph bundled + validated, 2026-06-11)

The graph asset is generated from the **real checkpoint header** (gate
approved) and bundled: 393 tensors, 4 labels, all F32. Validation performed
on the dev machine before bundling:

- **Bit-exact numerics** — the data file was rehydrated from the downloaded
  checkpoint using exactly the app's manifest-driven byte copies, run under
  onnxruntime, and compared to transformers/PyTorch ground truth:
  max |Δlogit| = 0.00000 across test inputs.
- **Label order confirmed** — index 0 = human (verbatim Dickens: 0.93 human;
  a typo-ridden churning-forum post: 0.90 human), index 3 = fully
  AI-generated (p≈1.00 on LLM-written paragraphs).
- **Tokenizer parity** — the TS byte-level BPE produces byte-identical ids
  to `RobertaTokenizerFast` on the real vocab across contractions, unicode,
  emoji, newlines and currency strings.

Exporter gotchas baked into `scripts/export_pangram_graph.py` (for re-runs):

- **`transformers<5` required** — v5 renamed RoBERTa internals; 4.x matches
  the checkpoint's classic names. The checkpoint also uses legacy
  `LayerNorm.gamma/beta` spellings — the script maps them.
- **`do_constant_folding=False` required** — folding bakes Linear weights
  pre-transposed under fresh `onnx::MatMul_*` names (unspliceable); with it
  off, weights keep state-dict names/layout behind explicit Transpose nodes
  that ORT folds at session load.
- Manifest keys are the **checkpoint's** tensor names; the script fails hard
  if any >4KB float initializer can't be backed by the checkpoint.
- The real config ships placeholder `LABEL_0..3` — `labelsFromConfig`
  rejects those, so UI copy uses the readable level names.

## int8 (v0.3.0) — quantization happens on-device

Core ML declines the dynamic-shape graph on real devices (XNNPACK fallback),
so the engine is now **int8 on CPU**: the shipped graph (0.7 MB) carries
dynamically-quantized MatMul ops, and rehydration COMPUTES the int8 weights
and scales from the user's fp32 checkpoint — quantized weights are still
Pangram derivatives, so they can never ship. Manifest v2 ops: `copy` (fp32
embeddings/LayerNorms/biases) and `quantize` (146 MatMul weights, transposed
flag found by value-matching at export).

Exact semantics, validated 0/539 tensors mismatched against onnxruntime's own
quantizer on the real checkpoint (`janus/app/quantize.ts`):

    scale = fround(amax / 127)            per-tensor symmetric, zp = 0
    q     = clip(roundHalfEven(fround(w / scale)), -127, 127)

Both `fround`s are load-bearing: float64 division moves ties (70 single-bit
mismatches), and `Math.round` is half-up where the reference is half-even.

Result: 512 MB on disk/RAM (was 1422), ~2.7× faster (Mac: 1242→460 ms per
512-token window), verdicts unchanged (max ΔP 0.0033). Installs from the fp32
era are detected by `dataBytes` mismatch and prompted to re-download (the
checkpoint was deleted post-rehydration; the token is saved).

## Neural Engine (v0.4.x) — fp16 Core ML, blob-spliced on-device

ONNX Runtime's CoreML execution provider aborts natively (uncatchable from
JS) on the int8 graph, so the ANE path bypasses ORT entirely:

- **Export** (`scripts/export_pangram_coreml.py`): coremltools converts the
  PyTorch model to an fp16 MLProgram — static `[1,512]` int32 inputs (the
  ANE wants fixed shapes), iOS 16 target. That yields a 0.28 MB
  `model.mlmodel` (architecture only, shippable) and a 711 MB `weight.bin`
  (Pangram derivative, never ships). The script walks every `blobFileValue`,
  parses `weight.bin`'s blob storage (0xDEADBEEF-sentinel metadata records,
  64-byte aligned), value-matches all 391 blobs back to checkpoint tensors
  (`torch.manual_seed(0)` + in-process matching — the classifier head
  re-randomizes per process), and emits a 90 KB manifest: every non-payload
  byte range base64'd, plus `{dataOffset, bytes, tensor, transposed}` per blob.
- **On-device rebuild** (`janus/app/coremlBuild.ts` + `float16.ts`):
  reconstructs `weight.bin` byte-for-byte from the user's fp32 download —
  header segments verbatim, each blob converted by a bit-level
  `f32ToF16Bits` (round-to-nearest-even incl. subnormals; numpy-golden
  tested) and transposed where the exporter did.
- **Native module** (`modules/pangram-coreml`): `MLModel.compileModel` once
  (cached `.mlmodelc` in Caches, keyed + stale-dropped), loaded with
  `computeUnits = .all`, `classify(ids, mask) → logits`. Inputs always pad
  to 512.
- **Rails**: a bad Core ML compile kills the process rather than throwing,
  so an MMKV crash fence poisons the ANE path if a launch dies mid-compile;
  the ladder falls back Neural Engine → int8 XNNPACK → CPU. `warmAiLens()`
  runs a throwaway micro-inference at boot so the one-time compile never
  lands inside a user-visible check.

Result: **63 ms per 512-token check** on an iPhone's ANE (field-measured) vs
~460 ms int8 CPU and 4.6 s fp32 — 73× over where v0.2.0 started. Validated
before shipping: rebuilt `weight.bin` bit-identical to the reference
conversion (391/391 blobs).

## Accuracy parity (measured)

Fidelity is proven byte-exact (above), but "conversion didn't change the
answers" was measured separately with `scripts/parity_pangram.py`: a
25-text battery (verbatim public-domain literature, LLM-written text in
both assistant and casual-human registers, human/AI splices,
borderline-bland texts, length sweep to 470 tokens) through all three
engines, fp32 as ground truth. The labels denote register, not verified
authorship — parity only needs the engines to agree with *each other* on
diverse, boundary-probing inputs:

| engine | argmax agreement | max ΔP (confident texts) | max ΔP (overall) |
|---|---|---|---|
| fp16 / ANE | 24/25 | 0.005 | 0.025 |
| int8 / XNNPACK | 25/25 | 0.05 | 0.13 |

Padding to the static 512 window is neutral (max ΔP 3e-6 vs unpadded). On
every text where the model is confident (top p ≥ 0.6 — the app's
`CONFIDENCE_FLOOR`), all three engines agree on the level and probabilities
move by at most a few hundredths. The only divergences live in the model's
own uncertainty zone: the one fp16 argmax flip was a deliberate human/AI
splice scored L1 at p=0.326 by fp32 vs L3 at p=0.331 by fp16 — a three-way
coin flip either way — and the one int8 floor crossing was 0.469→0.600 on
another splice. The floor exists for exactly that zone: any verdict under
0.6 is demoted to a plain label (`aiLensPolicy.ts:treatmentFor`), so
dim/collapse/hide never act on the texts where engines can disagree.

This bounds *conversion* error, not model error — Pangram's published
benchmarks describe the fp32 model; their eval set isn't public to re-run.
