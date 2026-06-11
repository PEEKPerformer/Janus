#!/usr/bin/env python3
"""Export the weight-free ONNX graph + rehydration manifest for AI Lens.

Open Pangram's checkpoint (pangram/editlens_roberta-large) is gated and
non-commercial, so Janus never bundles it. What Janus *does* bundle is the
architecture: an ONNX graph of RobertaForSequenceClassification exported from
the PUBLIC FacebookAI/roberta-large base (no Pangram IP), with every
checkpoint-backed weight externalized into a sidecar data file. The app
downloads the gated checkpoint with the user's own HF token and splices its
tensors into that sidecar ("rehydration") — see janus/app/pangramModel.ts.

This script emits:
  assets/models/pangram_graph.onnx      — graph; checkpoint weights are
                                          external-data refs, everything else
                                          (buffers, folded constants) inline
  assets/models/pangram_manifest.json   — tensor name -> (offset, bytes) map

The manifest is keyed off the REAL checkpoint's safetensors header (fetched
with a ranged request — a few hundred KB, not 1.4 GB), so every external ref
is guaranteed to have checkpoint bytes to fill it, and any initializer the
checkpoint can't back stays inline in the graph.

Run once on a dev machine (NOT by end users), with the Pangram gate accepted:
  pip install torch "transformers<5" onnx   # v5 renamed RoBERTa internals
  HF_TOKEN=hf_... python scripts/export_pangram_graph.py

Then point janus/app/pangramGraphAsset.ts at the generated assets (see the
comment there). metro.config.js already bundles .onnx as an asset.
"""

import json
import os
import struct
import sys
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


def fetch_checkpoint_header(token: str) -> tuple[dict, int]:
    """The safetensors header of the gated checkpoint (ranged request)."""
    head = hub_get("model.safetensors", token, byte_range="0-1048575")
    n = struct.unpack("<Q", head[:8])[0]
    if n > len(head) - 8:
        head = hub_get("model.safetensors", token, byte_range=f"0-{8 + n - 1}")
    hdr = json.loads(head[8 : 8 + n])
    hdr.pop("__metadata__", None)
    return hdr, n


def main() -> int:
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("HF_TOKEN is required (a read token with the Pangram gate accepted)")
        return 1

    print(f"Fetching {PANGRAM_REPO} config + safetensors header…")
    cfg = json.loads(hub_get("config.json", token))
    num_labels = int(cfg.get("num_labels") or len(cfg.get("id2label") or [])) or 4
    ckpt, _ = fetch_checkpoint_header(token)
    print(f"  num_labels={num_labels}, checkpoint tensors={len(ckpt)}")

    import torch
    import onnx
    from onnx import TensorProto
    from onnx.external_data_helper import set_external_data
    from transformers import RobertaForSequenceClassification

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    graph_path = OUT_DIR / GRAPH_NAME

    print(f"Loading public base {BASE_REPO} (weights are placeholders)…")
    model = RobertaForSequenceClassification.from_pretrained(
        BASE_REPO, num_labels=num_labels, torch_dtype=torch.float32
    )
    model.eval()

    dummy = {
        "input_ids": torch.ones(1, SEQ_LEN, dtype=torch.int64),
        "attention_mask": torch.ones(1, SEQ_LEN, dtype=torch.int64),
    }
    print("Exporting ONNX graph (TorchScript exporter, opset 17)…")
    export_kwargs = dict(
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "logits": {0: "batch"},
        },
        opset_version=17,
        # Folding would bake Linear weights in PRE-TRANSPOSED under fresh
        # names (onnx::MatMul_*) — unspliceable. Off, weights keep their
        # state-dict names/layout behind explicit Transpose nodes, which
        # onnxruntime folds itself at session load.
        do_constant_folding=False,
    )
    try:
        # torch >= 2.6 defaults to the dynamo exporter, which renames
        # initializers; the classic exporter keeps state-dict names.
        torch.onnx.export(model, (dummy,), str(graph_path), dynamo=False, **export_kwargs)
    except TypeError:
        torch.onnx.export(model, (dummy,), str(graph_path), **export_kwargs)

    print("Externalizing checkpoint-backed weights…")
    m = onnx.load(str(graph_path))

    def ckpt_key(name: str) -> str | None:
        # The checkpoint stores LayerNorm params with legacy gamma/beta names
        # (transformers maps them at load time); try those spellings too.
        spellings = [name]
        if name.endswith("LayerNorm.weight"):
            spellings.append(name[: -len("weight")] + "gamma")
        if name.endswith("LayerNorm.bias"):
            spellings.append(name[: -len("bias")] + "beta")
        for base in list(spellings):
            spellings.extend((f"roberta.{base}", base.removeprefix("roberta.")))
        for cand in spellings:
            if cand in ckpt:
                return cand
        return None

    tensors = []
    offset = 0
    kept_inline = []
    data_path = OUT_DIR / DATA_NAME
    with open(data_path, "wb") as data_file:
        for init in m.graph.initializer:
            key = ckpt_key(init.name)
            data = onnx.numpy_helper.to_array(init).tobytes()
            if key is None or init.data_type != TensorProto.FLOAT:
                # A real weight the checkpoint can't back would ship as the
                # public base's random placeholder — refuse outright.
                if init.data_type == TensorProto.FLOAT and len(data) > 4096:
                    print(f"FATAL: float initializer not in checkpoint: {init.name}")
                    return 1
                kept_inline.append(init.name)
                continue
            begin, end = ckpt[key]["data_offsets"]
            if end - begin != len(data):
                print(
                    f"FATAL: {init.name}: graph wants {len(data)} bytes, "
                    f"checkpoint has {end - begin}"
                )
                return 1
            pad = (-offset) % ALIGN
            data_file.write(b"\0" * pad)
            offset += pad
            data_file.write(data)
            set_external_data(init, location=DATA_NAME, offset=offset, length=len(data))
            init.data_location = TensorProto.EXTERNAL
            init.ClearField("raw_data")
            # Manifest keys are the CHECKPOINT's tensor names — the app looks
            # these up in the downloaded header, no name translation needed.
            tensors.append({"name": key, "dstOffset": offset, "bytes": len(data)})
            offset += len(data)

    if not tensors:
        print("FATAL: nothing externalized — exporter renamed initializers?")
        return 1
    missing = set(ckpt) - {t["name"] for t in tensors}
    if missing:
        print(f"note: {len(missing)} checkpoint tensors unused by the graph: "
              f"{sorted(missing)[:5]}{'…' if len(missing) > 5 else ''}")

    onnx.save_model(m, str(graph_path))
    onnx.checker.check_model(str(graph_path))  # data file present for this

    manifest = {
        "version": 1,
        "numLabels": num_labels,
        "dataTotalBytes": offset,
        "tensors": sorted(tensors, key=lambda t: t["dstOffset"]),
    }
    (OUT_DIR / MANIFEST_NAME).write_text(json.dumps(manifest, indent=1))
    (OUT_DIR / DATA_NAME).unlink(missing_ok=True)

    size = graph_path.stat().st_size
    print(
        f"OK: {GRAPH_NAME} = {size / 1e6:.1f} MB (graph-only), "
        f"{len(tensors)} external tensors -> {offset / 1e9:.2f} GB rehydrated, "
        f"{len(kept_inline)} inline initializers."
    )
    print("Next: wire janus/app/pangramGraphAsset.ts to these assets.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
