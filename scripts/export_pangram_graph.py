#!/usr/bin/env python3
"""Export the weight-free INT8 ONNX graph + rehydration manifest for AI Lens.

v2: the shipped graph is dynamically-quantized (int8 MatMul weights), ~4x
smaller in RAM and ~3x faster than fp32 on the XNNPACK/CPU path — and the
quantization happens ON DEVICE, because the gated checkpoint can't be
redistributed in any form, quantized included.

Pipeline (all from the PUBLIC FacebookAI/roberta-large base — placeholder
weights, zero Pangram IP):
  1. torch.onnx.export with do_constant_folding=False (state-dict names kept)
  2. onnxruntime BASIC optimization -> folds Transpose(weight) into MatMul
  3. onnxruntime quantize_dynamic (QInt8, MatMulConstBOnly)
  4. classify every initializer:
       - int8 "*_quantized"          -> manifest op QUANTIZE (device computes
         int8 data + fp32 scale from the user's downloaded fp32 checkpoint;
         the transposed flag is found by VALUE-matching against the public
         weights, since folding transposes most-but-not-all weights)
       - fp32 with a state-dict name -> manifest op COPY (straight bytes)
       - "*_zero_point", small consts -> inline in the graph (weight-free)
  5. externalize ckpt-derived tensors; write graph + manifest

Device-side semantics the manifest encodes (verified bit-for-bit against
onnxruntime's own output on the real checkpoint):
    scale = float32(amax / 127)          per-tensor, symmetric, zp = 0
    q     = clip(round_half_even(w / scale), -127, 127)   (transposed first
                                                           when flagged)

Run on a dev machine (NOT by end users), gate accepted:
  pip install torch "transformers<5" onnx onnxruntime
  HF_TOKEN=hf_... python scripts/export_pangram_graph.py
"""

import json
import os
import struct
import sys
import tempfile
import urllib.request
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "models"
GRAPH_NAME = "pangram_graph.onnx"
DATA_NAME = "pangram_weights.data"  # built on-device; never shipped
MANIFEST_NAME = "pangram_manifest.json"
PANGRAM_REPO = "pangram/editlens_roberta-large"
BASE_REPO = "FacebookAI/roberta-large"
SEQ_LEN = 512
ALIGN = 64


def hub_get(path: str, token: str, byte_range: str | None = None) -> bytes:
    req = urllib.request.Request(
        f"https://huggingface.co/{PANGRAM_REPO}/resolve/main/{path}",
        headers={"Authorization": f"Bearer {token}"}
        | ({"Range": f"bytes={byte_range}"} if byte_range else {}),
    )
    with urllib.request.urlopen(req) as r:
        return r.read()


def fetch_checkpoint_header(token: str) -> dict:
    head = hub_get("model.safetensors", token, byte_range="0-1048575")
    n = struct.unpack("<Q", head[:8])[0]
    if n > len(head) - 8:
        head = hub_get("model.safetensors", token, byte_range=f"0-{8 + n - 1}")
    hdr = json.loads(head[8 : 8 + n])
    hdr.pop("__metadata__", None)
    return hdr


def ckpt_spellings(name: str) -> list[str]:
    """Checkpoint-name candidates for a graph/state-dict name."""
    out = [name]
    if name.endswith("LayerNorm.weight"):
        out.append(name[: -len("weight")] + "gamma")
    if name.endswith("LayerNorm.bias"):
        out.append(name[: -len("bias")] + "beta")
    for base in list(out):
        out.extend((f"roberta.{base}", base.removeprefix("roberta.")))
    return out


def main() -> int:
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("HF_TOKEN is required (a read token with the Pangram gate accepted)")
        return 1

    print(f"Fetching {PANGRAM_REPO} config + safetensors header…")
    cfg = json.loads(hub_get("config.json", token))
    num_labels = int(cfg.get("num_labels") or len(cfg.get("id2label") or [])) or 4
    ckpt = fetch_checkpoint_header(token)
    print(f"  num_labels={num_labels}, checkpoint tensors={len(ckpt)}")

    import numpy as np
    import torch
    import onnx
    import onnxruntime as ort
    from onnx import TensorProto
    from onnx.external_data_helper import set_external_data
    from onnxruntime.quantization import quantize_dynamic, QuantType
    from transformers import RobertaForSequenceClassification

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="pangram-export-"))

    print(f"Loading public base {BASE_REPO} (weights are placeholders)…")
    model = RobertaForSequenceClassification.from_pretrained(
        BASE_REPO, num_labels=num_labels, torch_dtype=torch.float32
    )
    model.eval()
    public_sd = {k: v.detach().numpy() for k, v in model.state_dict().items()}

    print("Exporting fp32 graph (TorchScript exporter, no folding)…")
    fp32_path = work / "fp32.onnx"
    export_kwargs = dict(
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "logits": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=False,
    )
    dummy = {
        "input_ids": torch.ones(1, SEQ_LEN, dtype=torch.int64),
        "attention_mask": torch.ones(1, SEQ_LEN, dtype=torch.int64),
    }
    try:
        torch.onnx.export(model, (dummy,), str(fp32_path), dynamo=False, **export_kwargs)
    except TypeError:
        torch.onnx.export(model, (dummy,), str(fp32_path), **export_kwargs)

    print("Folding Transpose(weight) via onnxruntime BASIC optimization…")
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    so.optimized_model_filepath = str(work / "folded.onnx")
    ort.InferenceSession(str(fp32_path), so)

    print("Dynamic int8 quantization (QInt8, MatMul weights only)…")
    int8_path = work / "int8.onnx"
    quantize_dynamic(
        str(work / "folded.onnx"),
        str(int8_path),
        weight_type=QuantType.QInt8,
        # MatMul only: embedding Gather tables would otherwise quantize as
        # asymmetric UINT8 (a second semantics to replicate on-device, for
        # ~150MB) — they stay fp32 copy ops instead.
        op_types_to_quantize=["MatMul"],
        extra_options={"MatMulConstBOnly": True},
    )

    print("Classifying initializers + matching sources by value…")
    m = onnx.load(str(int8_path))
    inits = list(m.graph.initializer)
    by_name = {i.name: i for i in inits}

    def find_ckpt(name_like: str) -> str | None:
        for cand in ckpt_spellings(name_like):
            if cand in ckpt:
                return cand
        return None

    def source_for_quantized(init) -> tuple[str, bool]:
        """(ckpt tensor name, transposed) for a *_quantized initializer,
        proven by value-matching the dequantized data against the PUBLIC
        weights it was quantized from."""
        base = init.name[: -len("_quantized")]
        q = np.frombuffer(init.raw_data, dtype=np.int8).reshape(list(init.dims))
        scale = float(onnx.numpy_helper.to_array(by_name[f"{base}_scale"]))
        deq = q.astype(np.float32) * scale
        tol = scale * 0.51 + 1e-8
        for sd_name, w in public_sd.items():
            if w.size != q.size or w.ndim != 2:
                continue
            ck = find_ckpt(sd_name)
            if not ck:
                continue
            if w.T.shape == deq.shape and np.allclose(w.T, deq, atol=tol):
                return ck, True
            if w.shape == deq.shape and np.allclose(w, deq, atol=tol):
                return ck, False
        raise SystemExit(f"FATAL: no value-matched source for {init.name}")

    manifest_tensors: list[dict] = []
    offset = 0

    def alloc(nbytes: int) -> int:
        nonlocal offset
        offset += (-offset) % ALIGN
        at = offset
        offset += nbytes
        return at

    for init in inits:
        if init.name.endswith("_scale") or init.name.endswith("_zero_point"):
            continue  # scales ride with their weight; zero points stay inline
        if init.data_type == TensorProto.INT8 and init.name.endswith("_quantized"):
            src, transposed = source_for_quantized(init)
            nbytes = int(init.dims[0]) * int(init.dims[1])
            b, e = ckpt[src]["data_offsets"]
            if (e - b) != nbytes * 4:
                raise SystemExit(f"FATAL: size mismatch {init.name} vs {src}")
            data_at = alloc(nbytes)
            scale_at = alloc(4)
            scale_init = by_name[init.name[: -len("_quantized")] + "_scale"]
            if not scale_init.raw_data:
                # Scales arrive as float_data; external data needs raw bytes.
                scale_init.raw_data = onnx.numpy_helper.to_array(
                    scale_init
                ).tobytes()
                scale_init.ClearField("float_data")
            set_external_data(init, location=DATA_NAME, offset=data_at, length=nbytes)
            init.data_location = TensorProto.EXTERNAL
            init.ClearField("raw_data")
            set_external_data(scale_init, location=DATA_NAME, offset=scale_at, length=4)
            scale_init.data_location = TensorProto.EXTERNAL
            scale_init.ClearField("raw_data")
            manifest_tensors.append(
                {
                    "op": "quantize",
                    "name": src,
                    "transposed": transposed,
                    "dstOffset": data_at,
                    "bytes": nbytes,
                    "scaleOffset": scale_at,
                }
            )
            continue
        if init.data_type == TensorProto.FLOAT:
            src = find_ckpt(init.name)
            data = onnx.numpy_helper.to_array(init)
            if src is None:
                if data.nbytes > 4096:
                    raise SystemExit(f"FATAL: unmapped float initializer {init.name}")
                continue  # weight-independent constant, inline
            b, e = ckpt[src]["data_offsets"]
            if (e - b) != data.nbytes:
                raise SystemExit(f"FATAL: size mismatch {init.name} vs {src}")
            data_at = alloc(data.nbytes)
            set_external_data(init, location=DATA_NAME, offset=data_at, length=data.nbytes)
            init.data_location = TensorProto.EXTERNAL
            init.ClearField("raw_data")
            manifest_tensors.append(
                {"op": "copy", "name": src, "dstOffset": data_at, "bytes": data.nbytes}
            )
        # int64 shapes / misc constants stay inline.

    # Anything large still inline would ship placeholder weights — refuse.
    for init in m.graph.initializer:
        inline_bytes = len(init.raw_data) if init.raw_data else 0
        if (
            init.data_location != TensorProto.EXTERNAL
            and inline_bytes > 4096
            and init.data_type != TensorProto.INT64
        ):
            raise SystemExit(
                f"FATAL: large inline initializer would ship placeholders: "
                f"{init.name} ({inline_bytes} bytes, dtype {init.data_type})"
            )

    quant_count = sum(1 for t in manifest_tensors if t["op"] == "quantize")
    copy_count = len(manifest_tensors) - quant_count
    missing = set(ckpt) - {t["name"] for t in manifest_tensors}
    if missing:
        print(f"note: {len(missing)} ckpt tensors unused: {sorted(missing)[:5]}…")

    # The checker needs the data file present; a zero template suffices.
    data_path = OUT_DIR / DATA_NAME
    with open(data_path, "wb") as f:
        f.truncate(offset)
    graph_path = OUT_DIR / GRAPH_NAME
    onnx.save_model(m, str(graph_path))
    onnx.checker.check_model(str(graph_path))
    data_path.unlink()

    manifest = {
        "version": 2,
        "numLabels": num_labels,
        "dataTotalBytes": offset,
        "tensors": sorted(manifest_tensors, key=lambda t: t["dstOffset"]),
    }
    (OUT_DIR / MANIFEST_NAME).write_text(json.dumps(manifest, indent=1))
    print(
        f"OK: {GRAPH_NAME} = {graph_path.stat().st_size / 1e6:.1f} MB, "
        f"{quant_count} quantize + {copy_count} copy ops -> "
        f"{offset / 1e6:.0f} MB rehydrated (was 1422 MB fp32)."
    )
    print(f"(intermediates kept in {work})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
