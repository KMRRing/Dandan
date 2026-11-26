"""The worlds and option orders the GPU search uses for each deal of each position (as sk_search_t.py draws them from the
positions' keys), so the JS search can be run on exactly the same ones (exact_check.mjs): each world's starting hands, every
seat's cards in the order its options are tried (the searcher's own in its fixed order).
usage: python3 lab/schafkopf/gpu/worlds_dump.py <positions.jsonl> <deals> <seed> <out.jsonl>"""
import json, sys, torch
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sk_rules_t import Deals, C
from sk_deal_t import worlds
from sk_rng_t import mix, uniform
from sk_search_t import _order_keys

P = [json.loads(l) for l in open(sys.argv[1]) if l.startswith("{")]
N, SEED, out = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
B = len(P); chunk = 16
H = torch.zeros(B, 4, C, dtype=torch.bool)
for i, p in enumerate(P):
    for s, h in enumerate(p["hands"]): H[i, s, h] = True
D = Deals(H, torch.tensor([p["dealer"] for p in P]))
for t in range(max(len(p["log"]) for p in P)):
    a = torch.tensor([p["log"][t] if t < len(p["log"]) else -1 for p in P]); D.act(a.clamp(min=0), a >= 0)
seat = D.turn.clone(); keys = mix(torch.arange(B), SEED); own = uniform(keys, C, 31).float()
res = [[] for _ in range(B)]
for d0 in range(0, N, chunk):
    wk = mix(keys.repeat_interleave(chunk), torch.arange(d0, d0 + chunk).repeat(B))
    W, _ = worlds(D, seat, chunk, wk); ok = _order_keys(wk)
    for b in range(B):
        for j in range(chunk):
            r = b * chunk + j; hands = []
            for s in range(4):
                cards = W.dealt[r, s].nonzero().flatten().tolist()
                k = own[b] if s == int(seat[b]) else ok[r, :C]
                hands.append(sorted(cards, key=lambda c: float(k[c])))
            res[b].append(hands)
with open(out, "w") as f:
    for b in range(B): f.write(json.dumps({"worlds": res[b]}) + "\n")
