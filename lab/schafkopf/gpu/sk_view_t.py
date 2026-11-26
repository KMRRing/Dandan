"""A seat's view as the nets' inputs, from a batch of deals (sk_rules_t.Deals), exactly as lab/schafkopf/sk-view.js builds it:
rawView (612) and partnerView (11), the M1 policy's inputs before the beliefs. Held identical by test_views.py against
traces of the JS views. Every function takes the seat [B] whose view it is."""
import torch
from sk_rules_t import C, NB, STEP_BID, STEP_OVER, ACE, SAU_SUITS

RAW = dict(hand=C, history=C * 12, trick=4 * C, leader=4, toAct=4, bids=4 * (NB + 1), type=3, trump=4, ace=3, declarer=4, dealer=4, phase=2)
OFF = {}
_o = 0
for _k, _n in RAW.items(): OFF[_k] = _o; _o += _n
RAW_SIZE = _o
PART_SIZE = 11


def raw_view(D, seat):
    B, dev, ar = D.B, D.dev, D.ar
    x = torch.zeros(B, RAW_SIZE, device=dev)
    rel = lambda p: (p - seat + 4) % 4
    hand = D.hands[ar, seat].float()
    x[:, :C] = hand
    # history: each played card's trick (0..7) and who played it
    played = D.card_trick >= 0                                              # [B, 32]
    o = OFF["history"]
    bi, ci = played.nonzero(as_tuple=True)
    x[bi, o + ci * 12 + D.card_trick[bi, ci]] = 1
    x[bi, o + ci * 12 + 8 + (D.card_seat[bi, ci] - seat[bi] + 4) % 4] = 1
    # the open trick by position
    o = OFF["trick"]
    for i in range(4):
        on = D.trick_len > i
        b = ar[on]; x[b, o + i * C + D.trick[on, i]] = 1
    on = D.trick_len > 0
    x[ar[on], OFF["leader"] + rel(D.leader)[on]] = 1
    live = D.step != STEP_OVER
    x[ar[live], OFF["toAct"] + rel(D.turn)[live]] = 1
    # each seat's bid (none: the 10th slot)
    o = OFF["bids"]
    for p in range(4):
        r = (p - seat + 4) % 4
        k = torch.where(D.bid_of[:, p] >= 0, D.bid_of[:, p], torch.full_like(seat, NB))
        x[ar, o + r * (NB + 1) + k] = 1
    con = D.step != STEP_BID
    con = con & ~D.thrown
    ct = D.call_type
    x[ar[con], OFF["type"] + (ct[con] - 1)] = 1
    trump = torch.where(ct == 1, 1, torch.where(ct == 3, D.call_arg, -1))
    t = con & (trump >= 0)
    x[ar[t], OFF["trump"] + trump[t]] = 1
    s = con & (ct == 1)
    ace_i = torch.where(D.call_arg == 0, 0, torch.where(D.call_arg == 2, 1, 2))
    x[ar[s], OFF["ace"] + ace_i[s]] = 1
    x[ar[con], OFF["declarer"] + rel(D.declarer)[con]] = 1
    x[ar, OFF["dealer"] + rel(D.dealer)] = 1
    x[ar, OFF["phase"] + torch.where(D.step == STEP_BID, 0, 1)] = 1
    return x


def public_partner(D):
    """[B, 4] bool: who can be the partner on the public record (sk-view.js publicPartner); all false outside a Sauspiel."""
    sau = (D.call_type == 1) & (D.step != STEP_BID) & ~D.thrown
    can = D.pub_can.clone()
    if (D.run_n > 0).any():
        ace = D.ace.clamp(min=0); asuit = ace // 8
        F = D.t["FOLLOW"][D.cfg]
        called = (F == asuit[:, None]) & (torch.arange(C, device=D.dev)[None, :] != ace[:, None])   # [B, 32] the called suit, not the ace
        for p in range(4):
            for j in range(4):
                has = (D.run_n[:, p] > j) & can[:, p] & ~D.ace_fell
                if not has.any(): continue
                x, t = D.run_card[:, p, j], D.run_time[:, p, j]
                # cards it may have held then: of the called suit, not x, not played by another seat, not played before x
                by_other = (D.card_seat >= 0) & (D.card_seat != p)
                before = (D.card_time >= 0) & (D.card_time < t[:, None])
                spare = called & (torch.arange(C, device=D.dev)[None, :] != x[:, None]) & ~by_other & ~before
                ok = spare.sum(1) >= 2
                can[:, p] &= ~(has & ~ok)
    return can & sau[:, None]


def partner_view(D, seat):
    B, ar = D.B, D.ar
    x = torch.zeros(B, PART_SIZE, device=D.dev)
    con = (D.step != STEP_BID) & ~D.thrown
    pub = public_partner(D)
    sau = pub.any(1)
    rel = lambda p: (p - seat + 4) % 4
    ace = D.ace.clamp(min=0)
    holds = D.hands[ar, seat, ace] & sau & ~D.ace_fell
    seats = torch.arange(4, device=D.dev)[None, :]
    own = torch.where(D.ace_fell[:, None], pub, torch.where(holds[:, None], seats == seat[:, None], pub & (seats != seat[:, None])))
    own = own & sau[:, None]
    for p in range(4):
        r = (p - seat + 4) % 4
        x[ar, r] = torch.maximum(x[ar, r], pub[:, p].float())
        x[ar, 4 + r] = torch.maximum(x[ar, 4 + r], own[:, p].float())
    x[:, 8] = (sau & (pub.sum(1) == 1)).float()
    d = rel(D.declarer); after = 3 - D.trick_len
    x[:, 9] = (con & (d >= 1) & (d <= after)).float()
    x[:, 10] = (con & (d >= 1) & (d == after)).float()
    return x
