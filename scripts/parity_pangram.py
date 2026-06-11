#!/usr/bin/env python3
"""Accuracy-parity battery: fp32 reference vs both on-device AI Lens engines.

Byte-exact fidelity of the rehydrated artifacts is validated by the export
scripts; this answers the *other* question — did int8 quantization or the
fp16 Core ML conversion change the answers? No ground-truth labels needed:
the metrics are cross-engine argmax agreement, max softmax drift, and
crossings of the app's 0.6 confidence floor (below which treatments demote
to a plain label — `aiLensPolicy.ts:treatmentFor`).

Engines (artifacts produced by the export/validation scripts, all
byte-identical to what the phone builds from the user's own download):
  fp32 — $WORK/folded_real.onnx                 (logit-identical to torch)
  int8 — $WORK/int8run/run_int8.onnx            (shipped graph + device data)
  fp16 — $WORK/pangram_real.mlpackage           (Core ML, runs on the Mac ANE)

Run: PANGRAM_WORK=/tmp/pangram python scripts/parity_pangram.py
Measured 2026-06-11 (rev f93e1ac) — results recorded in docs/AI-LENS.md:
fp16 24/25 argmax agreement (the flip a p≈0.33 three-way coin flip), max
dP 0.025; int8 25/25, max dP 0.13 (uncertainty zone only); padding to the
static 512 window neutral at dP 3e-6.
"""
import os

import coremltools as ct
import numpy as np
import onnxruntime as ort
from transformers import RobertaTokenizerFast

W = os.environ.get("PANGRAM_WORK", "/tmp/pangram")
FLOOR = 0.6
tok = RobertaTokenizerFast(vocab_file=f"{W}/vocab.json", merges_file=f"{W}/merges.txt")
fp32 = ort.InferenceSession(f"{W}/folded_real.onnx")
int8 = ort.InferenceSession(f"{W}/int8run/run_int8.onnx")
ane = ct.models.MLModel(f"{W}/pangram_real.mlpackage", compute_units=ct.ComputeUnit.ALL)


def softmax(l):
    p = np.exp(l - l.max())
    return p / p.sum()


def run_ort(sess, ids, pad_to=None):
    mask = [1] * len(ids)
    if pad_to:
        mask += [0] * (pad_to - len(ids))
        ids = ids + [tok.pad_token_id] * (pad_to - len(ids))
    out = sess.run(["logits"], {"input_ids": np.array([ids], dtype=np.int64),
                                "attention_mask": np.array([mask], dtype=np.int64)})[0][0]
    return softmax(out)


def run_ane(ids):
    mask = [1] * len(ids) + [0] * (512 - len(ids))
    ids = ids + [tok.pad_token_id] * (512 - len(ids))
    out = ane.predict({"input_ids": np.array([ids], dtype=np.int32),
                       "attention_mask": np.array([mask], dtype=np.int32)})
    return softmax(np.array(list(out.values())[0]).reshape(-1))


# Provenance: the four literature openings are verbatim public domain
# (Bleak House, Pride and Prejudice, Moby-Dick, Huckleberry Finn) and
# borderline-wiki is near-verbatim Wikipedia ("Common swift"). EVERYTHING
# ELSE was written by the LLM that authored this harness — so the "llm-*"
# entries are genuinely machine-generated, while the other prefixes denote
# REGISTER, not verified human authorship. That's fine for parity (engines
# need only agree with each other on diverse inputs), but do NOT reuse the
# labels as detection-accuracy ground truth.
DICKENS = "London. Michaelmas term lately over, and the Lord Chancellor sitting in Lincoln's Inn Hall. Implacable November weather. As much mud in the streets as if the waters had but newly retired from the face of the earth, and it would not be wonderful to meet a Megalosaurus, forty feet long or so, waddling like an elephantine lizard up Holborn Hill."
TEXTS = [
    ("human-dickens", DICKENS),
    ("human-austen", "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters."),
    ("human-melville", "Call me Ishmael. Some years ago — never mind how long precisely — having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen, and regulating the circulation."),
    ("human-twain", "You don't know about me without you have read a book by the name of The Adventures of Tom Sawyer; but that ain't no matter. That book was made by Mr. Mark Twain, and he told the truth, mainly. There was things which he stretched, but mainly he told the truth."),
    ("human-forum1", "ok so update on the csr downgrade saga - called twice, first rep said no dice, HUCA'd and second rep did it in like 2 mins lol. also heads up the 5/24 thing bit me again, got denied for the ink even tho my biz spend is legit. anyone else seeing this?? gonna wait till august i guess"),
    ("human-forum2", "bruh i spent 3 hours debugging this and it was a TRAILING COMMA in the json config. three. hours. the error message said 'unexpected token' with no line number btw, absolute garbage dx. anyway works now, shipping it friday probably"),
    ("human-forum3", "my grandma used to make this with lard instead of butter and honestly?? better. fight me. also you gotta let the dough rest overnight, no exceptions, the recipe in the post skips that and it shows"),
    ("human-tech", "The race was in the retry path: two callers could both observe the circuit half-open and both fire a probe, and the second probe's failure would re-open a circuit the first had already closed. Fixed by making the probe token a CAS on the state struct rather than a bare read."),
    ("human-email", "Hey, running about 15 late, the 4 train is doing that thing again where it just sits at Union Square with the doors open. Order me whatever IPA they have on tap if you get there first. Also bring the charger if you still have it, mine died"),
    ("human-review", "Two stars. The zipper broke the second week and the 'waterproof' lining soaked through in a drizzle. To be fair the shoulder straps are comfortable and it does fit a 16 inch laptop like the listing says, but I expected more at this price. Returning it."),
    ("human-short", "lmao no way they shipped that on a friday"),
    ("human-short2", "this is the third time the bridge has been closed this month and nobody can tell us why"),
    ("llm-full1", "In conclusion, effective time management is a crucial skill that enables individuals to maximize productivity, reduce stress, and achieve a healthy work-life balance. By implementing structured routines and leveraging digital tools, one can unlock significant improvements across all areas of life."),
    ("llm-full2", "The Renaissance was a pivotal period in European history that fundamentally transformed art, science, and culture. Spanning roughly from the 14th to the 17th century, it marked a renewed interest in classical antiquity and humanism. Key figures such as Leonardo da Vinci and Michelangelo exemplified the era's spirit of innovation and creativity, leaving an enduring legacy that continues to shape our world today."),
    ("llm-full3", "Great question! There are several important factors to consider when choosing a programming language for your first project. First, consider the learning curve: languages like Python offer gentle syntax and extensive documentation. Second, think about community support, as a vibrant ecosystem can significantly accelerate your learning journey. Finally, evaluate the job market in your region to ensure your skills remain relevant and in demand."),
    ("llm-full4", "Regular exercise offers numerous benefits for both physical and mental health. It strengthens the cardiovascular system, improves muscle tone, and enhances flexibility. Moreover, physical activity releases endorphins, which are natural mood elevators that can help alleviate symptoms of anxiety and depression. Incorporating even thirty minutes of moderate exercise into your daily routine can yield substantial long-term health benefits."),
    ("llm-listy", "Here are the key considerations for your home network setup: 1. Router placement is critical for optimal coverage throughout your living space. 2. Modern mesh systems provide seamless roaming between access points. 3. Wired backhaul connections deliver superior performance compared to wireless alternatives. 4. Regular firmware updates ensure security vulnerabilities are promptly addressed."),
    ("mix-light", DICKENS + " The atmospheric conditions described serve to establish a pervasive sense of institutional stagnation that mirrors the legal proceedings at the heart of the narrative."),
    ("mix-heavy", "It is worth noting that the foggy conditions in Victorian London were a significant public health concern. " + "my great-great-grandfather actually worked as a clerk near chancery lane around then, family letters mention the fog ruining his one good coat lol. " + "The combination of coal smoke and natural fog created the infamous pea-soupers that persisted well into the twentieth century, with significant implications for respiratory health among the urban population."),
    ("borderline-bland", "The meeting is scheduled for Tuesday at 3pm in the main conference room. Please bring your laptops and any questions about the quarterly report. Coffee will be provided. Let me know if you have any conflicts with this time."),
    ("borderline-wiki", "The common swift (Apus apus) is a medium-sized bird, superficially similar to the barn swallow or house martin but somewhat larger, though not stemming from those passerine species, since swifts are in the separate order Apodiformes. The swifts' nearest relatives are the New World hummingbirds."),
    ("borderline-news", "City officials announced Tuesday that the downtown bridge will close for repairs starting next month. The closure is expected to last six weeks, and commuters are advised to use the Fifth Street crossing during that period. Local businesses have expressed concern about reduced foot traffic."),
]
# Length sweep: same human base repeated to fill windows of growing size.
for reps, tag in [(2, "len-160"), (4, "len-320"), (6, "len-480")]:
    TEXTS.append((f"human-{tag}", ((DICKENS + " ") * reps).strip()))

rows, flips_int8, flips_ane, floor_int8, floor_ane = [], [], [], [], []
dmax_int8 = dmax_ane = dpad = 0.0
for name, text in TEXTS:
    ids = tok(text, truncation=True, max_length=512)["input_ids"]
    pf = run_ort(fp32, ids)
    pfp = run_ort(fp32, ids, pad_to=512)  # padding-neutrality check
    pi = run_ort(int8, ids)
    pa = run_ane(ids)
    dpad = max(dpad, float(np.abs(pf - pfp).max()))
    di, da = float(np.abs(pf - pi).max()), float(np.abs(pf - pa).max())
    dmax_int8, dmax_ane = max(dmax_int8, di), max(dmax_ane, da)
    vf, vi, va = int(pf.argmax()), int(pi.argmax()), int(pa.argmax())
    if vi != vf:
        flips_int8.append(name)
    if va != vf:
        flips_ane.append(name)
    if (pf.max() >= FLOOR) != (pi.max() >= FLOOR):
        floor_int8.append(name)
    if (pf.max() >= FLOOR) != (pa.max() >= FLOOR):
        floor_ane.append(name)
    rows.append((name, len(ids), vf, pf.max(), vi, pi.max(), di, va, pa.max(), da))

print(f"{'text':18s} {'tok':>4s} | fp32      | int8       dP     | fp16/ANE   dP")
for n, L, vf, cf, vi, ci, di, va, ca, da in rows:
    fi = " " if vi == vf else "FLIP"
    fa = " " if va == vf else "FLIP"
    print(f"{n:18s} {L:4d} | L{vf} {cf:.3f}  | L{vi} {ci:.3f} {di:.4f} {fi}| L{va} {ca:.3f} {da:.4f} {fa}")
print()
print(f"texts: {len(rows)}  |  pad-neutrality max dP (fp32 padded vs not): {dpad:.6f}")
print(f"int8 : argmax agreement {len(rows) - len(flips_int8)}/{len(rows)}, max dP {dmax_int8:.4f}, floor({FLOOR}) crossings: {floor_int8 or 'none'}{', flips: ' + str(flips_int8) if flips_int8 else ''}")
print(f"fp16 : argmax agreement {len(rows) - len(flips_ane)}/{len(rows)}, max dP {dmax_ane:.4f}, floor({FLOOR}) crossings: {floor_ane or 'none'}{', flips: ' + str(flips_ane) if flips_ane else ''}")
