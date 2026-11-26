"""The tensor views against sk-view.js's (sk_view_t.py): a trace with views (trace.mjs ... views) replayed as one batch; at every
step the raw view and the partner view of the seat to move and the seat after it must match exactly.
usage: python3 lab/schafkopf/gpu/test_views.py <trace.jsonl> [device]"""
import json, sys, torch
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sk_rules_t import Deals, C
from sk_view_t import raw_view, partner_view, RAW_SIZE

lines = [json.loads(l) for l in open(sys.argv[1]) if l.startswith("{")]
dev = sys.argv[2] if len(sys.argv) > 2 else "cpu"
B = len(lines)
hands = torch.zeros(B, 4, C, dtype=torch.bool)
for i, g in enumerate(lines):
    for p, h in enumerate(g["hands"]): hands[i, p, h] = True
D = Deals(hands.to(dev), torch.tensor([g["dealer"] for g in lines]))
T = max(len(g["steps"]) for g in lines)
bad = views = 0
for t in range(T):
    for j in range(2):
        seat = torch.tensor([g["steps"][t]["views"][j]["p"] if t < len(g["steps"]) else 0 for g in lines], device=dev)
        R = raw_view(D, seat).cpu(); P = partner_view(D, seat).cpu()
        for i, g in enumerate(lines):
            if t >= len(g["steps"]): continue
            v = g["steps"][t]["views"][j]; views += 1
            want = torch.zeros(RAW_SIZE); want[v["raw"]] = 1
            if not torch.equal(R[i], want) or [round(float(a), 6) for a in P[i]] != [round(float(a), 6) for a in v["part"]]:
                bad += 1
                if bad < 8:
                    diff = (R[i] != want).nonzero().flatten().tolist()
                    print(f"deal {i} step {t} seat {v['p']}: raw differs at {diff[:12]}; part {P[i].tolist()} / {v['part']}")
    a = torch.tensor([g["steps"][t]["a"] if t < len(g["steps"]) else 0 for g in lines], device=dev)
    D.act(a)
print(f"test_views: {B} deals, {views} views on {dev}; mismatches {bad}")
sys.exit(1 if bad else 0)
