"""Packs of lab/zero/replay-pack.mjs (train mode) made side by side, one folder each, merged into one (15 Nov 2026: three
generations of games, Korbi 10:45, are more than one replay finishes in the runner's six hours). Policy packs (p, q: the
lab/fetch-ex.mjs format) get their candidate and mark offsets moved on; value packs (v) are put one after another.
usage: python3 lab/zero/pack-merge.py <out dir> <in dir> [<in dir>…]
"""
import json, os, shutil, sys
import numpy as np

# Streamed, each input file deleted once copied (15 Nov 2026: g9s-C's runner was lost at the merge, three generations' x.f32
# being ~10 GB read whole and concatenated: twice the runner's memory, and the disk held it twice over)
out, ins = sys.argv[1], sys.argv[2:]
def append(dst, src):
    with open(src, "rb") as f, open(dst, "ab") as g: shutil.copyfileobj(f, g, 64 << 20)
    os.remove(src)
# the policy packs present (p and q from replay-pack.mjs; a, moves and answers together, from replay-pack2.mjs)
for sub in [x for x in ("p", "q", "a") if os.path.exists(os.path.join(ins[0], x, "meta.json"))]:
    metas = [json.load(open(os.path.join(d, sub, "meta.json"))) for d in ins]
    os.makedirs(os.path.join(out, sub), exist_ok=True)
    XN = next((m["XN"] for m in metas if m["XN"]), 0)
    for k in ("x.f32", "cand.i32", "pick.i16", "med.i16", "flags.u8", "q.f32", "mark.i32", "marks.u8"):
        open(os.path.join(out, sub, k), "wb").close()
    C = K = D = 0
    for d, m in zip(ins, metas):
        if m["decisions"] == 0: continue
        src = lambda n: os.path.join(d, sub, n)
        for k in ("x.f32", "pick.i16", "med.i16", "flags.u8", "q.f32", "marks.u8"): append(os.path.join(out, sub, k), src(k))
        # the offsets, moved on by what came before (small: one int a decision)
        (np.fromfile(src("cand.i32"), np.int32)[:-1] + C).astype(np.int32).tofile(open(os.path.join(out, sub, "cand.i32"), "ab"))
        (np.fromfile(src("mark.i32"), np.int32)[:-1] + K).astype(np.int32).tofile(open(os.path.join(out, sub, "mark.i32"), "ab"))
        C += m["candidates"]; K += m["marks"]; D += m["decisions"]
    np.array([C], np.int32).tofile(open(os.path.join(out, sub, "cand.i32"), "ab")); np.array([K], np.int32).tofile(open(os.path.join(out, sub, "mark.i32"), "ab"))
    json.dump(dict(XN=XN, decisions=D, candidates=C, marks=K, exports=metas[0].get("exports"), every=True, **({"markN": metas[0]["markN"]} if "markN" in metas[0] else {})), open(os.path.join(out, sub, "meta.json"), "w"))
    print(f"{sub}: {D} decisions, {C} candidates, {K} marks from {len(ins)} packs")
metas = [json.load(open(os.path.join(d, "v", "meta.json"))) for d in ins]
os.makedirs(os.path.join(out, "v"), exist_ok=True)
for k in ("mine.f32", "theirs.f32", "won.f32", "hold.u8") + (("aux.f32",) if os.path.exists(os.path.join(ins[0], "v", "aux.f32")) else ()):
    open(os.path.join(out, "v", k), "wb").close()
    for d in ins: append(os.path.join(out, "v", k), os.path.join(d, "v", k))
N = next((m["N"] for m in metas if m["N"]), 0)
json.dump(dict(N=N, rows=sum(m["rows"] for m in metas), skipped=sum(m["skipped"] for m in metas), ids=metas[0].get("ids"), **({"aux": True} if metas[0].get("aux") else {})), open(os.path.join(out, "v", "meta.json"), "w"))
print(f"v: {sum(m['rows'] for m in metas)} rows from {len(ins)} packs")
