#!/usr/bin/env python3
"""Export the weight-free ONNX graph + rehydration manifest for AI Lens.

Open Pangram's checkpoint (pangram/editlens_roberta-large) is gated and
non-commercial, so Janus never bundles it. What Janus *does* bundle is the
architecture: an ONNX graph of RobertaForSequenceClassification exported from
the PUBLIC FacebookAI/roberta-large base (no Pangram IP), with every weight
externalized into a sidecar data file. The app downloads the gated checkpoint
with the user's own HF token and splices its tensors into that sidecar
("rehydration") — see janus/app/pangramModel.ts.

This script emits:
  assets/models/pangram_graph.onnx      — graph, external-data references only
  assets/models/pangram_manifest.json   — tensor name -> (offset, bytes) map

Run once on a dev machine (NOT by end users):
  pip install torch transformers onnx
  python scripts/export_pangram_graph.py            # num_labels defaults to 4
  python scripts/export_pangram_graph.py --num-labels-from-hub  # needs HF_TOKEN
                                                     # + accepted Pangram gate

Then point janus/app/pangramGraphAsset.ts at the generated assets (see the
comment there) and add "onnx" to metro.config.js assetExts.
"""

import argparse
import json
import os
import struct
import sys
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "models"
GRAPH_NAME = "pangram_graph.onnx"
DATA_NAME = "pangram_weights.data"  # never shipped; layout template only
MANIFEST_NAME = "pangram_manifest.json"
PANGRAM_REPO = "pangram/editlens_roberta-large"
BASE_REPO = "FacebookAI/roberta-large"


def resolve_num_labels(args) -> int:
    if not args.num_labels_from_hub:
        return args.num_labels
    # Read the real label count from the gated repo's config.json.
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(PANGRAM_REPO, "config.json", token=os.environ.get("HF_TOKEN"))
    cfg = json.loads(Path(path).read_text())
    n = int(cfg.get("num_labels") or len(cfg.get("id2label") or [])) or 4
    print(f"num_labels from {PANGRAM_REPO}: {n}")
    return n


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--num-labels", type=int, default=4)
    parser.add_argument("--num-labels-from-hub", action="store_true")
    parser.add_argument("--seq-len", type=int, default=512)
    args = parser.parse_args()

    import torch
    import onnx
    from transformers import RobertaForSequenceClassification

    num_labels = resolve_num_labels(args)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading public base {BASE_REPO} (weights are placeholders)…")
    model = RobertaForSequenceClassification.from_pretrained(
        BASE_REPO, num_labels=num_labels, torch_dtype=torch.float32
    )
    model.eval()

    seq = args.seq_len
    dummy = {
        "input_ids": torch.ones(1, seq, dtype=torch.int64),
        "attention_mask": torch.ones(1, seq, dtype=torch.int64),
    }
    graph_path = OUT_DIR / GRAPH_NAME
    print("Exporting ONNX graph…")
    torch.onnx.export(
        model,
        (dummy,),
        str(graph_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "logits": {0: "batch"},
        },
        opset_version=17,
    )

    # Externalize every initializer into one data file with a deterministic
    # layout, then keep only the graph + manifest. The app rebuilds the data
    # file on-device from the user's downloaded checkpoint.
    print("Externalizing weights…")
    m = onnx.load(str(graph_path))
    onnx.save_model(
        m,
        str(graph_path),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=DATA_NAME,
        size_threshold=0,
        convert_attribute=False,
    )

    m = onnx.load(str(graph_path), load_external_data=False)
    tensors = []
    total = 0
    for init in m.graph.initializer:
        if init.data_location != onnx.TensorProto.EXTERNAL:
            continue
        info = {e.key: e.value for e in init.external_data}
        offset, length = int(info.get("offset", 0)), int(info["length"])
        # ONNX initializer names follow the torch state_dict; safetensors
        # names in the checkpoint match (modulo an optional "roberta." prefix
        # the app already tolerates).
        tensors.append({"name": init.name, "dstOffset": offset, "bytes": length})
        total = max(total, offset + length)
    tensors.sort(key=lambda t: t["dstOffset"])

    manifest = {
        "version": 1,
        "numLabels": num_labels,
        "dataTotalBytes": total,
        "tensors": tensors,
    }
    (OUT_DIR / MANIFEST_NAME).write_text(json.dumps(manifest, indent=1))
    (OUT_DIR / DATA_NAME).unlink(missing_ok=True)  # template only — not shipped

    size = graph_path.stat().st_size
    print(
        f"Wrote {GRAPH_NAME} ({size/1e6:.1f} MB graph-only), "
        f"{MANIFEST_NAME} ({len(tensors)} tensors, {total/1e9:.2f} GB rehydrated)."
    )
    print("Next: wire janus/app/pangramGraphAsset.ts to these assets.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
