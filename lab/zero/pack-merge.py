"""Packs of lab/zero/replay-pack.mjs (train mode) made side by side, one folder each, merged into one (15 Nov 2026: three
generations of games, Korbi 10:45, are more than one replay finishes in the runner's six hours). Policy packs (p, q: the
lab/fetch-ex.mjs format) get their candidate and mark offsets moved on; value packs (v) are put one after another.
usage: python3 lab/zero/pack-merge.py <out dir> <in dir> [<in dir>…]
"""
import json, os, sys
import numpy as np

out, ins = sys.argv[1], sys.argv[2:]
for sub in ("p", "q"):
    metas = [json.load(open(os.path.join(d, sub, "meta.json"))) for d in ins]
    os.makedirs(os.path.join(out, sub), exist_ok=True)
    XN = next((m["XN"] for m in metas if m["XN"]), 0)
    parts = {k: [] for k in ("x.f32", "cand.i32", "pick.i16", "med.i16", "flags.u8", "q.f32", "mark.i32", "marks.u8")}
    C = K = D = 0
    for d, m in zip(ins, metas):
        rd = lambda n, t: np.fromfile(os.path.join(d, sub, n), dtype=t)
        if m["decisions"] == 0: continue
        parts["x.f32"].append(rd("x.f32", np.float32)); parts["pick.i16"].append(rd("pick.i16", np.int16)); parts["med.i16"].append(rd("med.i16", np.int16))
        parts["flags.u8"].append(rd("flags.u8", np.uint8)); parts["q.f32"].append(rd("q.f32", np.float32)); parts["marks.u8"].append(rd("marks.u8", np.uint8))
        parts["cand.i32"].append(rd("cand.i32", np.int32)[:-1] + C); parts["mark.i32"].append(rd("mark.i32", np.int32)[:-1] + K)
        C += m["candidates"]; K += m["marks"]; D += m["decisions"]
    parts["cand.i32"].append(np.array([C], np.int32)); parts["mark.i32"].append(np.array([K], np.int32))
    for k, v in parts.items(): np.concatenate(v).tofile(os.path.join(out, sub, k))
    json.dump(dict(XN=XN, decisions=D, candidates=C, marks=K, exports=metas[0].get("exports"), every=True), open(os.path.join(out, sub, "meta.json"), "w"))
    print(f"{sub}: {D} decisions, {C} candidates, {K} marks from {len(ins)} packs")
metas = [json.load(open(os.path.join(d, "v", "meta.json"))) for d in ins]
os.makedirs(os.path.join(out, "v"), exist_ok=True)
for k, t in (("mine.f32", np.float32), ("theirs.f32", np.float32), ("won.f32", np.float32), ("hold.u8", np.uint8)):
    np.concatenate([np.fromfile(os.path.join(d, "v", k), dtype=t) for d in ins]).tofile(os.path.join(out, "v", k))
N = next((m["N"] for m in metas if m["N"]), 0)
json.dump(dict(N=N, rows=sum(m["rows"] for m in metas), skipped=sum(m["skipped"] for m in metas), ids=metas[0].get("ids")), open(os.path.join(out, "v", "meta.json"), "w"))
print(f"v: {sum(m['rows'] for m in metas)} rows from {len(ins)} packs")
