"""The search on the GPU (Fable's step 4): dandan-think.js's game-mode search (bareThink, as Monte zero and M1 run it) for many
positions at once.

Per position: every legal option is a root move with its own tree; deal by deal a world is drawn (sk_deal_t.py), each option still
in the race is played in it, then the tree is walked (UCB with EXPLORE 0.3, an unvisited option first in its order, progressive
widening 1 + floor(sqrt(n - 1)), a decision's children keyed by who moves and what) until a decision not met before, after which
the policy plays the deal out (greedy). The deal's value for every seat, 0.5 + 0.5 x payoff / SD, is credited to each decision on
the path by its mover; the root option takes the searcher's. Looks at 16, 32, ... deals (128, ... at 1,024) prune options more than
three standard errors of the paired gap (floor SPREAD) behind the leader, plus 0.01; at 256 deals the search stops once the same
option has led clearly at two looks in a row. The best is the highest mean among those still in the race.

Every position advances one deal at a time, all positions and all their options together, so the tree sees deal d's result
before deal d + 1 as in the JS. Orders: bids as Codex lists them; cards in an order drawn per world (the searcher's own in an order
fixed per position), as the JS's hand orders are."""
import math, torch
from sk_rules_t import Deals, C, ACTIONS, STEP_BID
from sk_deal_t import worlds

EXPLORE, EARLY, LOOK_FROM, SPREAD, SD = 0.3, 16, 128, 0.06, 5.5
UNVISITED = 1e9
# Codex's bid order (sk-view.js actions 32..40 are pass, sau0, sau2, sau3, wenz, solo0..3; Codex lists solo 3, 2, 1, 0)
BID_ORDER = {32: 0, 33: 1, 34: 2, 35: 3, 36: 4, 40: 5, 39: 6, 38: 7, 37: 8}


def _order_keys(B, own_key, seat, gen, dev):
    """[B, 41]: each action's place in its options' order (lower first)."""
    k = torch.rand(B, ACTIONS, generator=gen, device=dev)
    for a, r in BID_ORDER.items(): k[:, a] = 10 + r
    return k


def search(D, net, deals_card=256, deals_bid=1024, gen=None, chunk=16):
    """The search's decision for the seat to move in each deal of D. Returns (best [B], means [B, 41] (nan where not an option),
    n [B, 41] deals each option was played, deals run [B])."""
    dev, B = D.dev, D.B
    seat = D.turn.clone()
    L0 = D.legal()
    nopt = L0.sum(1)
    bid = D.step == STEP_BID
    deals = torch.where(bid, deals_bid, deals_card)
    Dmax = int(deals.max())
    cand = L0.clone()                                        # [B, 41] the root options
    Cm = int(nopt.max())
    # each position's options as a compact list
    cidx = torch.full((B, Cm), -1, dtype=torch.long, device=dev)
    for b in range(B):
        ix = cand[b].nonzero().flatten(); cidx[b, :len(ix)] = ix
    alive = cand.clone() & (nopt[:, None] > 1)
    vals = torch.zeros(B, ACTIONS, Dmax, device=dev)
    cnt = torch.zeros(B, ACTIONS, dtype=torch.long, device=dev)
    # the trees: one per (position, option); nodes up to deals + 1; children keyed by who x action
    T, NMAX, SL = B * Cm, Dmax + 1, 4 * ACTIONS
    e_n = torch.zeros(T, NMAX, SL, dtype=torch.int32, device=dev)
    e_w = torch.zeros(T, NMAX, SL, dtype=torch.float32, device=dev)
    e_av = torch.zeros(T, NMAX, SL, dtype=torch.int32, device=dev)
    child = torch.full((T, NMAX, SL), -1, dtype=torch.int32, device=dev)
    node_n = torch.zeros(T, NMAX, dtype=torch.int32, device=dev)
    count = torch.ones(T, dtype=torch.long, device=dev)
    own_key = torch.rand(B, C, generator=gen, device=dev)
    lead_prev = torch.full((B,), -1, dtype=torch.long, device=dev)
    steady_looks = torch.zeros(B, dtype=torch.long, device=dev)
    steady = torch.where(deals == 256, 2, 0)
    first = torch.where(deals <= 256, EARLY, LOOK_FROM)
    running = (alive.sum(1) > 1)
    d = 0
    W = None
    while running.any() and d < Dmax:
        if d % chunk == 0:
            W, _ = worlds(D, seat, chunk, gen)                # [B * chunk] worlds for the next `chunk` deals
        # the simulations: every running position's alive options in this deal's world
        sb, sa = (alive & running[:, None]).nonzero(as_tuple=True)
        S = sb.numel()
        tree = sb * Cm + (cidx[sb] == sa[:, None]).long().argmax(1)
        Wi = W.take(sb * chunk + d % chunk)
        okey = _order_keys(S, own_key, seat, gen, dev)
        mine = Wi.dealt[torch.arange(S, device=dev), seat[sb]]                    # the searcher's cards: its fixed order
        okey[:, :C] = torch.where(mine, own_key[sb], okey[:, :C])
        Wi.act(sa)
        node = torch.zeros(S, dtype=torch.long, device=dev)
        growing = torch.ones(S, dtype=torch.bool, device=dev)
        path_t, path_n, path_s, path_who, path_on = [], [], [], [], []
        ar = torch.arange(S, device=dev)
        for _ in range(4 + C):
            live = ~Wi.over()
            if not live.any(): break
            L = Wi.legal(); who = Wi.turn
            k = L.sum(1)
            multi = live & (k > 1)
            tr = multi & growing
            act = torch.zeros(S, dtype=torch.long, device=dev)
            single = live & (k == 1)
            act[single] = L[single].long().argmax(1)
            if tr.any():
                i = ar[tr]; t, nd, w = tree[i], node[i], who[i]
                node_n[t, nd] += 1
                nn_ = node_n[t, nd]
                allow = torch.minimum(k[i], 1 + torch.floor(torch.sqrt((nn_ - 1).float())).long())
                key = okey[i].masked_fill(~L[i], 1e9)
                rank = key.argsort(1).argsort(1)                                   # each action's place among the options
                consider = L[i] & (rank < allow[:, None])
                slot = w[:, None] * ACTIONS + torch.arange(ACTIONS, device=dev)[None, :]
                en = e_n[t[:, None], nd[:, None], slot]; ew = e_w[t[:, None], nd[:, None], slot]
                av = e_av[t[:, None], nd[:, None], slot] + consider.int()
                e_av[t[:, None], nd[:, None], slot] = av
                v = torch.where(en > 0, ew / en.clamp(min=1) + EXPLORE * torch.sqrt(torch.log(av.clamp(min=1).float()) / en.clamp(min=1).float()), UNVISITED - rank.float() / 100)
                v = v.masked_fill(~consider, -1e18)
                a = v.argmax(1)
                act[i] = a
                s_ = w * ACTIONS + a
                path_t.append(t); path_n.append(nd); path_s.append(s_); path_who.append(w); path_on.append(i)
                ch = child[t, nd, s_].long()
                new = ch < 0
                if new.any():
                    nid = count[t[new]]
                    child[t[new], nd[new], s_[new]] = nid.int()
                    count[t[new]] += 1
                    growing[i[new]] = False
                node[i[~new]] = ch[~new]
            po = multi & ~growing
            if po.any():
                i = ar[po]
                Wp = Wi.take(i) if i.numel() < S else Wi
                z = net.forward(Wp, Wp.turn) if i.numel() < S else net.forward(Wi, Wi.turn)
                Lp = L[i]
                act[i] = z.masked_fill(~Lp, -1e30).argmax(1)
                # take() copies: keep the original batch, act on it below
            Wi.act(act, live)
        u = 0.5 + 0.5 * Wi.payoff / SD                                             # [S, 4]
        for t, nd, s_, w, i in zip(path_t, path_n, path_s, path_who, path_on):
            e_n[t, nd, s_] += 1
            e_w[t, nd, s_] += u[i, w]
        vals[sb, sa, cnt[sb, sa]] = u[ar, seat[sb]]
        cnt[sb, sa] += 1
        d += 1
        # the looks: at 16 (128), 32, ... deals, prune; with steady, stop on a clear leader twice running
        look = running & (d >= first) & ((d & (d - 1)) == 0)
        if look.any():
            for b in look.nonzero().flatten().tolist():
                al = alive[b].nonzero().flatten()
                if al.numel() < 2: continue
                k = int(cnt[b, al].min())
                V = vals[b, al, :k]
                mean = V.mean(1); li = int(mean.argmax()); lead = al[li]
                diffs = V[li][None, :] - V
                m = diffs.mean(1); sd = diffs.std(1, unbiased=True) if k > 1 else torch.zeros_like(m)
                keep = m < 3 * torch.clamp(sd, min=SPREAD) / math.sqrt(k) + 0.01
                keep[li] = True
                alive[b, al[~keep]] = False
                if int(steady[b]) and alive[b].sum() > 1:
                    al2 = alive[b].nonzero().flatten(); V2 = vals[b, al2, :k]; mean2 = V2.mean(1); l2 = int(mean2.argmax())
                    dd = V2[l2][None, :] - V2; m2 = dd.mean(1); s2 = dd.std(1, unbiased=True)
                    clear = all(m2[j] >= 3 * max(float(s2[j]), SPREAD) / math.sqrt(k) for j in range(al2.numel()) if j != l2)
                    top = int(al2[l2]) if clear else -1
                    steady_looks[b] = steady_looks[b] + 1 if (top >= 0 and top == int(lead_prev[b])) else (1 if top >= 0 else 0)
                    lead_prev[b] = top
                    if int(steady_looks[b]) >= int(steady[b]): running[b] = False
        running &= (alive.sum(1) > 1) & (d < deals)
    means = torch.full((B, ACTIONS), float("nan"), device=dev)
    played = cnt > 0
    sums = torch.zeros(B, ACTIONS, device=dev)
    for b in range(B):
        for a in cand[b].nonzero().flatten().tolist():
            n = int(cnt[b, a])
            if n: means[b, a] = vals[b, a, :n].mean()
    score = torch.where(alive & played, means, torch.full_like(means, -1e9))
    best = torch.where(nopt > 1, score.argmax(1), L0.long().argmax(1))
    return best, means, cnt, torch.tensor(d)
