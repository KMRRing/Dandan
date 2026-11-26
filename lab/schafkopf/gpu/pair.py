"""Two searches of the same positions (compare.mjs's JS lines, or compare.py --dump's GPU lines): per option the gap in means
in standard errors of the difference (each side's own se, floored at 0.01), the share of picks they agree on, and the mean
gap. usage: python3 lab/schafkopf/gpu/pair.py <a.jsonl> <b.jsonl> [label]"""
import json, sys, math, torch
A = [json.loads(l) for l in open(sys.argv[1]) if l.startswith("{")]
B = [json.loads(l) for l in open(sys.argv[2]) if l.startswith("{")]
n = min(len(A), len(B)); zs, gaps, same = [], [], 0
for a, b in zip(A[:n], B[:n]):
    assert a["log"] == b["log"], "not the same positions"
    oa = {x[0]: x for x in a["opts"]}; ob = {x[0]: x for x in b["opts"]}
    for k, (_, m, c, se) in oa.items():
        if k in ob and c >= 16 and ob[k][2] >= 16:
            s = math.sqrt(max(se, 0.01) ** 2 + max(ob[k][3], 0.01) ** 2)
            zs.append((ob[k][1] - m) / s); gaps.append(ob[k][1] - m)
    same += a["best"] == b["best"]
z = torch.tensor(zs); g = torch.tensor(gaps)
print(f"{sys.argv[3] if len(sys.argv) > 3 else ''}: {n} positions; same pick {same}/{n}; gap {g.mean():+.4f} (sd {g.std():.4f}); z sd {z.std():.2f}, mean {z.mean():+.2f}, |z|>3 {int((z.abs() > 3).sum())} of {len(zs)}")
