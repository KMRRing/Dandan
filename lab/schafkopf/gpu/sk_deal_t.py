"""The dealer on the GPU (Fable's step 3): worlds a seat can't tell from the real deal, for many positions at once.

A world is valid if and only if the deal's record replays legally in it (Fable, 24 Nov 18:50Z), as in sk-rules.js. The JS
dealer draws uniform shuffles of the unseen cards and rejects; here the proposal is uniform over the worlds that respect the
voids the play has shown (count matrices of class x seat weighted by the product of multinomials, by a dynamic programme, then
shuffled within each class), and the same replay check rejects the rest (the bids, the called-ace rules). Both are uniform
over the valid worlds. test_deal.py checks validity and uniformity against exact enumeration on small positions."""
import torch
from sk_rules_t import Deals, C, STEP_PLAY

CAP = 9                                            # a seat holds at most 8 unseen cards


def _lgam(x):
    return torch.lgamma(x.double() + 1)


def worlds(D, seat, n, gen=None, max_rounds=60):
    """n worlds for each deal in D, as seen by `seat` [B]: a Deals of B*n deals (world j of deal i at i*n + j), replayed to the
    position, the seat's own hand as it is. Returns (worlds, draws): draws is how many proposals each world took on average."""
    dev, B = D.dev, D.B
    F = D.t["FOLLOW"][D.cfg]                                                 # [B, 32] follow class (bidding: suit, as cfg 0's)
    played = D.card_seat >= 0
    mine = D.dealt[D.ar, seat]
    unseen = ~mine & ~played                                                 # [B, 32]
    sizes = D.hands.sum(2)                                                   # [B, 4] cards each seat holds now
    others = torch.stack([(seat + k) % 4 for k in (1, 2, 3)], 1)            # [B, 3]
    need = sizes.gather(1, others)                                           # [B, 3]
    allowed = ~D.void.gather(1, others[:, :, None].expand(B, 3, 5))          # [B, 3, 5]
    in_play = (D.step >= STEP_PLAY)[:, None]
    allowed = allowed | ~in_play[:, :, None]                                 # no voids before play
    ncls = torch.stack([(unseen & (F == c)).sum(1) for c in range(5)], 1)    # [B, 5]
    # backward: W[c][b, r1, r2] = log of the number of ways to place classes c.. given seats 1 and 2 still need r1, r2
    # (seat 3 takes the rest, which the totals fix)
    r = torch.arange(CAP, device=dev)
    rem_after = [ncls[:, c:].sum(1) for c in range(6)]                       # cards in classes c..4
    NEG = -1e30
    W = [None] * 6
    W[5] = torch.full((B, CAP, CAP), NEG, dtype=torch.float64, device=dev); W[5][:, 0, 0] = 0
    for c in range(4, -1, -1):
        Wc = torch.full((B, CAP, CAP), NEG, dtype=torch.float64, device=dev)
        nc = ncls[:, c]
        for k1 in range(CAP):
            for k2 in range(CAP):
                k3 = nc - k1 - k2
                ok = (k3 >= 0) & ((k1 == 0) | allowed[:, 0, c]) & ((k2 == 0) | allowed[:, 1, c]) & ((k3 == 0) | allowed[:, 2, c])
                if not ok.any(): continue
                lw = _lgam(nc) - _lgam(torch.tensor(k1)) - _lgam(torch.tensor(k2)) - _lgam(k3.clamp(min=0))
                # W_c(r1, r2) += ways * W_{c+1}(r1 - k1, r2 - k2) for r1 >= k1, r2 >= k2
                sub = torch.full((B, CAP, CAP), NEG, dtype=torch.float64, device=dev)
                sub[:, k1:, k2:] = W[c + 1][:, :CAP - k1, :CAP - k2]
                term = torch.where(ok[:, None, None], lw[:, None, None] + sub, torch.full_like(sub, NEG))
                Wc = torch.logaddexp(Wc, term)
        W[c] = Wc
    # forward, per world: each class's split, drawn in proportion to its ways times the ways left
    N = B * n
    owner = torch.arange(B, device=dev).repeat_interleave(n)
    rounds, todo, draws = 0, torch.arange(N, device=dev), torch.zeros(N, device=dev)
    result = torch.full((N, 4, C), False, device=dev)
    while todo.numel() and rounds < max_rounds:
        rounds += 1
        o = owner[todo]; M = todo.numel()
        r1, r2 = need[o, 0].clone(), need[o, 1].clone()
        split = torch.zeros(M, 5, 3, dtype=torch.long, device=dev)
        for c in range(5):
            nn_ = ncls[o, c]
            lw = torch.full((M, CAP, CAP), NEG, dtype=torch.float64, device=dev)
            for k1 in range(CAP):
                for k2 in range(CAP):
                    k3 = nn_ - k1 - k2
                    ok = (k3 >= 0) & (k1 <= r1) & (k2 <= r2) & ((k1 == 0) | allowed[o, 0, c]) & ((k2 == 0) | allowed[o, 1, c]) & ((k3 == 0) | allowed[o, 2, c])
                    if not ok.any(): continue
                    w = _lgam(nn_) - _lgam(torch.tensor(k1)) - _lgam(torch.tensor(k2)) - _lgam(k3.clamp(min=0)) + W[c + 1][o, (r1 - k1).clamp(0, CAP - 1), (r2 - k2).clamp(0, CAP - 1)]
                    lw[:, k1, k2] = torch.where(ok, w, torch.full_like(w, NEG))
            flat = lw.view(M, -1)
            g = -torch.log(-torch.log(torch.rand(M, CAP * CAP, generator=gen, device=dev).clamp(1e-12, 1)))
            pick = (flat + g).argmax(1)
            k1, k2 = pick // CAP, pick % CAP
            split[:, c, 0], split[:, c, 1], split[:, c, 2] = k1, k2, nn_ - k1 - k2
            r1, r2 = r1 - k1, r2 - k2
        # the cards: within each class a random order, then the first k1 to the first other seat, the next k2 to the second
        key = torch.rand(M, C, generator=gen, device=dev) + (~unseen[o]).float() * 10       # unseen first, in random order
        Fo = F[o]
        hands = D.dealt[o].clone()
        for p in range(3): hands[torch.arange(M, device=dev), others[o, p]] = False
        # each seat's dealt cards that were played (it held them)
        for p in range(3):
            q = others[o, p]
            hands[torch.arange(M, device=dev), q] = (D.card_seat[o] == q[:, None])
        for c in range(5):
            kc = torch.where((Fo == c) & unseen[o], key, torch.full_like(key, 99.0))
            order = kc.argsort(1)                                                    # class c's unseen cards first, shuffled
            rank_ = torch.empty_like(order); rank_.scatter_(1, order, torch.arange(C, device=dev).expand(M, C))
            cls = (Fo == c) & unseen[o]
            a1, a2 = split[:, c, 0:1], split[:, c, 0:1] + split[:, c, 1:2]
            to1 = cls & (rank_ < a1); to2 = cls & (rank_ >= a1) & (rank_ < a2); to3 = cls & (rank_ >= a2)
            for p, tp in enumerate((to1, to2, to3)):
                ix = torch.arange(M, device=dev)
                hands[ix, others[o, p]] |= tp
        # replay the record in them
        R = Deals(hands, D.dealer[o])
        ok = torch.ones(M, dtype=torch.bool, device=dev)
        T = int(D.nlog.max())
        for t in range(T):
            live = t < D.nlog[o]
            a = D.log[o, t].clamp(min=0)
            L = R.legal()
            ok &= ~live | L[torch.arange(M, device=dev), a]
            R.act(a, live & ok)
        draws[todo] += 1
        good = todo[ok]
        if good.numel():
            result[good] = hands[ok]
        todo = todo[~ok]
    if todo.numel(): raise RuntimeError(f"sk_deal_t: {todo.numel()} worlds found no valid deal in {max_rounds} rounds")
    Wd = Deals(result, D.dealer[owner])
    for t in range(int(D.nlog.max())):
        a = D.log[owner, t]
        Wd.act(a.clamp(min=0), a >= 0)
    return Wd, float(draws.mean())

