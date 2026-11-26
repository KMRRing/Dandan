"""The tensor rules against Codex's own (sk_rules_t.py; Korbi 26 Nov 2026, the GPU engine): every deal of a trace of random
legal play (trace.mjs), all at once as one batch: at every step the seat to move and its legal actions must match, and at the
end the payoff. usage: python3 lab/schafkopf/gpu/test_rules.py <trace.jsonl> [device]"""
import json, sys, torch
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sk_rules_t import Deals, C, ACTIONS

lines = [json.loads(l) for l in open(sys.argv[1]) if l.startswith("{")]
dev = sys.argv[2] if len(sys.argv) > 2 else "cpu"
B = len(lines)
hands = torch.zeros(B, 4, C, dtype=torch.bool)
for i, g in enumerate(lines):
    for p, h in enumerate(g["hands"]): hands[i, p, h] = True
D = Deals(hands.to(dev), torch.tensor([g["dealer"] for g in lines]))
T = max(len(g["steps"]) for g in lines)
bad = 0
for t in range(T):
    L = D.legal().cpu(); turn = D.turn.cpu(); live = ~D.over().cpu()
    a = torch.zeros(B, dtype=torch.long)
    for i, g in enumerate(lines):
        if t >= len(g["steps"]):
            if live[i]: bad += 1; print(f"deal {i}: still running after Codex ended it at step {t}") if bad < 10 else None
            continue
        st = g["steps"][t]
        if not live[i] or int(turn[i]) != st["seat"] or L[i].nonzero().flatten().tolist() != st["legal"]:
            bad += 1
            if bad < 10: print(f"deal {i} step {t}: live {bool(live[i])} seat {int(turn[i])}/{st['seat']} legal {L[i].nonzero().flatten().tolist()} / {st['legal']}")
        a[i] = st["a"]
    D.act(a.to(dev))
pay = D.payoff.cpu()
for i, g in enumerate(lines):
    if pay[i].tolist() != [float(x) for x in g["payoff"]]:
        bad += 1
        if bad < 20: print(f"deal {i}: payoff {pay[i].tolist()} / {g['payoff']}")
kinds = {}
for g in lines:
    b = [s["a"] - C for s in g["steps"] if s["a"] >= C and s["a"] != C]
    kinds["thrown" if not b else ("sau" if b[-1] <= 3 else "wenz" if b[-1] == 4 else "solo")] = kinds.get("thrown" if not b else ("sau" if b[-1] <= 3 else "wenz" if b[-1] == 4 else "solo"), 0) + 1
print(f"test_rules: {B} deals, {sum(len(g['steps']) for g in lines)} steps on {dev}; {kinds}; mismatches {bad}")
sys.exit(1 if bad else 0)
