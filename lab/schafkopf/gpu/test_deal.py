"""The GPU dealer (sk_deal_t.py) against exact enumeration: on late positions (few unseen cards), every assignment of the unseen
cards to the other seats is replayed to find the valid worlds; the dealer's draws must all be valid, and spread evenly over them
(a chi-square test per position, and over all). usage: python3 lab/schafkopf/gpu/test_deal.py [positions] [draws each]"""
import sys, itertools, math, torch
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sk_rules_t import Deals, deal_random, ACTIONS, C
from sk_deal_t import worlds

P = int(sys.argv[1]) if len(sys.argv) > 1 else 12
N = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
g = torch.Generator().manual_seed(11)
D = deal_random(400, g)
# play on (passes are drawn less often, so most deals get a contract) to the start of trick 6 or 7
target = torch.randint(20, 26, (400,), generator=g)
for t in range(30):
    L = D.legal(); w = L.float() * torch.rand(400, ACTIONS, generator=g); w[:, C] *= 0.3
    live = ~D.over() & (D.plays < target)
    D.act(w.argmax(1), live)
keep = (~D.over() & (D.plays >= 18)).nonzero().flatten()[:P]
D = D.take(keep); seat = D.turn.clone()
bad = 0; chi_tot = 0.0; dof_tot = 0
W, draws = worlds(D, seat, N, g)
for i in range(D.B):
    s = int(seat[i]); others = [(s + k) % 4 for k in (1, 2, 3)]
    unseen = [k for k in range(C) if not D.dealt[i, s, k] and D.card_seat[i, k] < 0]
    need = [int(D.hands[i, p].sum()) for p in others]
    # every assignment, replayed
    cands = []
    for a in itertools.combinations(unseen, need[0]):
        rest = [k for k in unseen if k not in a]
        for b in itertools.combinations(rest, need[1]):
            c = [k for k in rest if k not in b]
            cands.append((a, b, tuple(c)))
    H = torch.zeros(len(cands), 4, C, dtype=torch.bool)
    for j, (a, b, c) in enumerate(cands):
        H[j, s] = D.dealt[i, s]
        for p, cards in zip(others, (a, b, c)):
            H[j, p, list(cards)] = True
            H[j, p] |= (D.card_seat[i] == p)
    R = Deals(H, D.dealer[i].repeat(len(cands)))
    ok = torch.ones(len(cands), dtype=torch.bool)
    for t in range(int(D.nlog[i])):
        a = D.log[i, t].repeat(len(cands)); L = R.legal(); ok &= L[torch.arange(len(cands)), a]; R.act(a, ok)
    valid = {tuple(tuple(sorted(x)) for x in cands[j]) for j in ok.nonzero().flatten().tolist()}
    # the dealer's draws for this position
    seen = {}
    for j in range(N):
        h = W.hands[i * N + j]
        key = tuple(tuple(k for k in range(C) if h[p, k]) for p in others)
        if key not in valid: bad += 1
        seen[key] = seen.get(key, 0) + 1
    m = len(valid); e = N / m
    chi = sum((seen.get(v, 0) - e) ** 2 / e for v in valid)
    chi_tot += chi; dof_tot += m - 1
    print(f"position {i}: {len(unseen)} unseen, {len(cands)} assignments, {m} valid; chi-square {chi:.1f} on {m - 1}")
z = (chi_tot - dof_tot) / math.sqrt(2 * max(dof_tot, 1))
print(f"test_deal: {D.B} positions, {N} draws each ({draws:.2f} proposals a world); invalid {bad}; chi-square {chi_tot:.0f} on {dof_tot} (z {z:+.2f})")
sys.exit(1 if bad or abs(z) > 4 else 0)
