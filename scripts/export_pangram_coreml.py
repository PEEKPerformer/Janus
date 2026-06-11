#!/usr/bin/env python3
"""Export the weight-free Core ML (ANE) assets for AI Lens.

Emits, from the PUBLIC roberta-large architecture (zero Pangram IP):
  assets/models/pangram_coreml.mlmodel        — fp16 MLProgram skeleton (~0.3MB)
  assets/models/pangram_coreml_manifest.json  — how the device builds weight.bin:
      headerSegments: [ [offset, base64] ]    — every non-data byte of the
                                                blob file (header + metadata)
      blobs: [ {dataOffset, bytes, name, transposed} ]
      packageManifest: the .mlpackage Manifest.json content
      weightBinSize, numLabels

On device, rehydration writes the segments verbatim, then each blob's fp16
payload (converted from the user's downloaded fp32 checkpoint, transposed
where flagged) at its dataOffset. MLModel.compileModel does the rest.

Validated on the dev Mac (see memory/ane_splice.py): 391/391 blobs are pure
fp16 casts of state-dict tensors; spliced model = identical verdicts to
fp32, 90ms per 512-token window on the M-series ANE.

Run: pip install torch "transformers<5" coremltools
     HF_TOKEN=hf_... python scripts/export_pangram_coreml.py
"""

import base64
import json
import os
import shutil
import struct
import sys
import tempfile
import urllib.request
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "models"
PANGRAM_REPO = "pangram/editlens_roberta-large"
BASE_REPO = "FacebookAI/roberta-large"
SEQ = 512


def hub_get(path: str, token: str, byte_range: str | None = None) -> bytes:
    req = urllib.request.Request(
        f"https://huggingface.co/{PANGRAM_REPO}/resolve/main/{path}",
        headers={"Authorization": f"Bearer {token}"}
        | ({"Range": f"bytes={byte_range}"} if byte_range else {}),
    )
    with urllib.request.urlopen(req) as r:
        return r.read()


def fetch_header(token: str) -> dict:
    head = hub_get("model.safetensors", token, byte_range="0-1048575")
    n = struct.unpack("<Q", head[:8])[0]
    hdr = json.loads(head[8 : 8 + n])
    hdr.pop("__metadata__", None)
    return hdr


def ckpt_name(hdr: dict, name: str) -> str:
    for cand in (
        name,
        f"roberta.{name}",
        name.removeprefix("roberta."),
        name.replace("LayerNorm.weight", "LayerNorm.gamma"),
        name.replace("LayerNorm.bias", "LayerNorm.beta"),
        f"roberta.{name}".replace("LayerNorm.weight", "LayerNorm.gamma"),
        f"roberta.{name}".replace("LayerNorm.bias", "LayerNorm.beta"),
    ):
        if cand in hdr:
            return cand
    raise SystemExit(f"FATAL: no checkpoint tensor for {name}")


def main() -> int:
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("HF_TOKEN required")
        return 1

    import numpy as np
    import torch
    import coremltools as ct
    from coremltools.proto import Model_pb2
    from transformers import RobertaForSequenceClassification

    print("Fetching checkpoint header + config…")
    cfg = json.loads(hub_get("config.json", token))
    num_labels = int(cfg.get("num_labels") or len(cfg.get("id2label") or [])) or 4
    hdr = fetch_header(token)

    torch.manual_seed(0)
    model = RobertaForSequenceClassification.from_pretrained(
        BASE_REPO, num_labels=num_labels, torch_dtype=torch.float32
    )
    model.eval()
    sd16 = {
        k: v.detach().numpy().astype(np.float16)
        for k, v in model.state_dict().items()
    }

    class Wrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, attention_mask):
            return self.m(input_ids=input_ids, attention_mask=attention_mask).logits

    print("Tracing + converting to fp16 MLProgram (static 512)…")
    traced = torch.jit.trace(
        Wrapper(model),
        (
            torch.ones(1, SEQ, dtype=torch.int32),
            torch.ones(1, SEQ, dtype=torch.int32),
        ),
    )
    mlmodel = ct.convert(
        traced,
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT16,
        inputs=[
            ct.TensorType(name="input_ids", shape=(1, SEQ), dtype=np.int32),
            ct.TensorType(name="attention_mask", shape=(1, SEQ), dtype=np.int32),
        ],
        outputs=[ct.TensorType(name="logits")],
        minimum_deployment_target=ct.target.iOS16,
    )
    work = Path(tempfile.mkdtemp(prefix="pangram-coreml-"))
    pkg = work / "skeleton.mlpackage"
    mlmodel.save(str(pkg))
    data_dir = pkg / "Data" / "com.apple.CoreML"

    print("Inventorying blobs…")
    spec = Model_pb2.Model()
    spec.ParseFromString((data_dir / "model.mlmodel").read_bytes())
    blob_metas = []

    def walk(block):
        for op in block.operations:
            for _n, attr in op.attributes.items():
                if attr.HasField("blobFileValue"):
                    blob_metas.append(attr.blobFileValue.offset)
            for b in op.blocks:
                walk(b)

    for f in spec.mlProgram.functions.values():
        for blk in f.block_specializations.values():
            walk(blk)

    raw = (data_dir / "weights" / "weight.bin").read_bytes()
    blobs = []
    for moff in blob_metas:
        sentinel, _dt = struct.unpack_from("<II", raw, moff)
        assert sentinel == 0xDEADBEEF, hex(sentinel)
        size, doff = struct.unpack_from("<QQ", raw, moff + 8)
        a = np.frombuffer(raw, dtype=np.float16, count=size // 2, offset=doff)
        hit = None
        for k, w in sd16.items():
            if w.size != a.size:
                continue
            if np.array_equal(w.reshape(-1), a):
                hit = (k, False)
                break
            if w.ndim == 2 and np.array_equal(w.T.reshape(-1), a):
                hit = (k, True)
                break
        if hit is None:
            raise SystemExit(f"FATAL: unmatched blob at {moff} ({size} bytes)")
        blobs.append(
            {
                "dataOffset": doff,
                "bytes": size,
                "name": ckpt_name(hdr, hit[0]),
                "transposed": hit[1],
            }
        )
    blobs.sort(key=lambda b: b["dataOffset"])

    # Everything that is NOT blob payload ships as verbatim segments.
    segments = []
    cursor = 0
    for b in blobs:
        if b["dataOffset"] > cursor:
            segments.append(
                [cursor, base64.b64encode(raw[cursor : b["dataOffset"]]).decode()]
            )
        cursor = b["dataOffset"] + b["bytes"]
    if cursor < len(raw):
        segments.append([cursor, base64.b64encode(raw[cursor:]).decode()])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy(data_dir / "model.mlmodel", OUT_DIR / "pangram_coreml.mlmodel")
    manifest = {
        "version": 3,
        "numLabels": num_labels,
        "weightBinSize": len(raw),
        "packageManifest": json.loads((pkg / "Manifest.json").read_text()),
        "headerSegments": segments,
        "blobs": blobs,
    }
    (OUT_DIR / "pangram_coreml_manifest.json").write_text(json.dumps(manifest))
    seg_bytes = sum(len(base64.b64decode(s[1])) for s in segments)
    print(
        f"OK: pangram_coreml.mlmodel = "
        f"{(OUT_DIR / 'pangram_coreml.mlmodel').stat().st_size / 1e6:.2f} MB, "
        f"manifest = {(OUT_DIR / 'pangram_coreml_manifest.json').stat().st_size / 1e6:.2f} MB "
        f"({len(blobs)} blobs, {seg_bytes / 1e3:.0f} KB header segments, "
        f"weight.bin = {len(raw) / 1e6:.0f} MB on device)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
