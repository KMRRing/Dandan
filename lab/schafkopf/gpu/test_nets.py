"""The tensor nets against sk-net.js (sk_net_t.py): a trace with NET=<net> replayed as one batch; the net's outputs for the seat
to move must match to 1e-4. usage: python3 lab/schafkopf/gpu/test_nets.py <trace.jsonl> <net file> [device]"""
import json, sys, torch
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sk_rules_t import Deals, C
from sk_net_t import load

lines = [json.loads(l) for l in open(sys.argv[1]) if l.startswith("{")]
dev = sys.argv[3] if len(sys.argv) > 3 else "cpu"
net = load(sys.argv[2], dev)
B = len(lines)
hands = torch.zeros(B, 4, C, dtype=torch.bool)
for i, g in enumerate(lines):
    for p, h in enumerate(g["hands"]): hands[i, p, h] = True
D = Deals(hands.to(dev), torch.tensor([g["dealer"] for g in lines]))
worst, n = 0.0, 0
for t in range(max(len(g["steps"]) for g in lines)):
    live = torch.tensor([t < len(g["steps"]) for g in lines])
    out = net.forward(D, D.turn).cpu()
    for i, g in enumerate(lines):
        if not live[i]: continue
        worst = max(worst, float((out[i] - torch.tensor(g["steps"][t]["out"])).abs().max())); n += 1
    D.act(torch.tensor([g["steps"][t]["a"] if t < len(g["steps"]) else 0 for g in lines], device=dev))
print(f"test_nets: {B} deals, {n} positions on {dev}; worst |torch - js| {worst:.2e}")
sys.exit(1 if worst > 1e-4 else 0)
