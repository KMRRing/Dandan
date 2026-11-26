"""The GPU search against the JS search on the same positions (compare.mjs): per option the means' gap in standard errors (the
two searches are independent samples of the same estimate), and how often they pick the same move.
usage: python3 lab/schafkopf/gpu/compare.py <positions.jsonl> <net> [deals] [biddeals] [device]"""
import json, sys, math, time, torch
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sk_rules_t import Deals, C, STEP_BID
from sk_net_t import load
from sk_search_t import search
from sk_rng_t import mix

P = [json.loads(l) for l in open(sys.argv[1]) if l.startswith("{")]
net_path = sys.argv[2]; deals = int(sys.argv[3]) if len(sys.argv) > 3 else 256; bd = int(sys.argv[4]) if len(sys.argv) > 4 else 256
dev = sys.argv[5] if len(sys.argv) > 5 else "cpu"
net = load(net_path, dev)
B = len(P)
hands = torch.zeros(B, 4, C, dtype=torch.bool)
for i, p in enumerate(P):
    for s, h in enumerate(p["hands"]): hands[i, s, h] = True
D = Deals(hands.to(dev), torch.tensor([p["dealer"] for p in P]))
for t in range(max(len(p["log"]) for p in P)):
    a = torch.tensor([p["log"][t] if t < len(p["log"]) else -1 for p in P], device=dev)
    D.act(a.clamp(min=0), a >= 0)
assert all(int(D.turn[i]) == p["seat"] for i, p in enumerate(P)), "replay: the seat to move differs"
t0 = time.time()
SEED = int(sys.argv[6]) if len(sys.argv) > 6 else 1
best, means, cnt, d = search(D, net, deals_card=deals, deals_bid=bd, keys=mix(torch.arange(B, device=dev), SEED))
dt = time.time() - t0
if "--dump" in sys.argv:
    # the GPU's results as compare.mjs writes the JS's, for pair.py
    with open(sys.argv[sys.argv.index("--dump") + 1], "w") as f:
        for i, p in enumerate(P):
            opts = [[a, float(means[i, a]), int(cnt[i, a]), float(search.se[i, a]) if search.se[i, a] == search.se[i, a] else 0.0] for a, *_ in p["opts"]]
            f.write(json.dumps({**{k: p[k] for k in ("hands", "dealer", "log", "seat", "step")}, "best": int(best[i]), "opts": opts}) + "\n")
zs, same, top_same = [], 0, 0
for i, p in enumerate(P):
    js = {a: (m, n, se) for a, m, n, se in p["opts"]}
    for a, (m, n, se) in js.items():
        if n < 16 or int(cnt[i, a]) < 16: continue
        # the GPU's se from its deals is unknown here; take the JS's as both (same deal counts)
        zs.append((float(means[i, a]) - m) / (math.sqrt(2) * max(se, 0.01)))
    same += int(best[i]) == p["best"]
z = torch.tensor(zs)
if "-v" in sys.argv:
    for i, p in enumerate(P):
        print(i, p["step"], "js", [(a, round(m, 3), n) for a, m, n, se in p["opts"]], "\n   gpu", [(a, round(float(means[i, a]), 3), int(cnt[i, a])) for a, *_ in p["opts"]])
print(f"compare: {B} positions in {dt:.1f}s; same pick {same}/{B}; mean gaps (GPU less JS) in SE: mean {z.mean():+.2f}, sd {z.std():.2f}, |z|>3 {int((z.abs() > 3).sum())} of {len(zs)}")
js_n = sum(sum(n for _, _, n, _ in p["opts"]) for p in P); gpu_n = int(cnt.sum())
print(f"option-deals played: JS {js_n}, GPU {gpu_n}; positions stopped early (fewer than the full deals on the leader): JS {sum(max(n for _, _, n, _ in p["opts"]) < (bd if p["step"] == "bid" else deals) for p in P)}, GPU {int(((cnt.max(1).values) < torch.where(D.step == STEP_BID, bd, deals)).sum())}")
