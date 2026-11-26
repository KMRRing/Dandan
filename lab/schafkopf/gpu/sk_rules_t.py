"""Schafkopf's rules as tensor operations over a batch of deals (Korbi, 26 Nov 2026: "we're going GPU"; Fable's step 1).

Codex's rules exactly (lab/schafkopf/codex/trumps-games.js, the copy checked against Crates), as the lab drives them
(lab/schafkopf/sk-rules.js): one deal, bidding included; a deal everyone passes is thrown in and pays nothing; the payoff is
each seat's delta in tariffs (÷ the Sauspiel tariff). Held identical by test_rules.py against traces of Codex itself.

Cards are 0..31: suit × 8 + rank, the suits 0 bells, 1 hearts, 2 leaves, 3 acorns, the ranks 7 8 9 10 U O K A. Actions are
the lab's (sk-view.js): 0..31 a card, then the nine bids: pass, Sauspiel calling the bells/leaves/acorns ace, Wenz, Solo in
each suit. Everything is [B, ...] on one device; a finished deal ignores further actions.
"""
import torch

C, NB, ACTIONS = 32, 9, 41
SEVEN, EIGHT, NINE, TEN, UNTER, OBER, KING, ACE = range(8)
POINTS = [0, 0, 0, 10, 2, 3, 4, 11]
TARIFF_SOLO = 5                                   # the Solo's and the Wenz's base, in Sauspiel tariffs (50 ÷ 10)
BID_PASS, BID_SAU = 0, (1, 2, 3)                  # bid indices; Sauspiel calling suits 0, 2, 3
SAU_SUITS = (0, 2, 3)
BID_WENZ, BID_SOLO = 4, (5, 6, 7, 8)              # Solo in suits 0..3
STEP_BID, STEP_PLAY, STEP_OVER = 0, 1, 2

suit = torch.arange(C) // 8
rank = torch.arange(C) % 8

# the six trump setups: 0 Sauspiel (hearts), 1 Wenz, 2..5 Solo in suits 0..3
def _tables():
    plain = {SEVEN: 0, EIGHT: 1, NINE: 2, KING: 3, TEN: 4, ACE: 5}                 # S_PLAIN: 7 8 9 K 10 A
    wenz_plain = {SEVEN: 0, EIGHT: 1, NINE: 2, OBER: 3, KING: 4, TEN: 5, ACE: 6}  # 7 8 9 O K 10 A
    trump = torch.zeros(6, C, dtype=torch.bool); follow = torch.zeros(6, C, dtype=torch.long); power = torch.zeros(6, C, dtype=torch.long)
    for cfg in range(6):
        wenz, tsuit = cfg == 1, (1 if cfg == 0 else cfg - 2 if cfg >= 2 else -1)
        for k in range(C):
            s, r = int(suit[k]), int(rank[k])
            t = (r == UNTER) if wenz else (r in (OBER, UNTER) or s == tsuit)
            trump[cfg, k] = t
            follow[cfg, k] = 4 if t else s
            if t:
                tp = 50 + s if wenz else 60 + s if r == OBER else 50 + s if r == UNTER else plain[r]
                power[cfg, k] = 100 + tp
            else:
                power[cfg, k] = (wenz_plain if wenz else plain)[r]
    return trump, follow, power
TRUMP, FOLLOW, POWER = _tables()
PTS = torch.tensor([POINTS[int(r)] for r in rank])
# each setup's trumps from the top, for the Laufende (Sauspiel and Solo 14, Wenz 4; padded with -1)
TOP = torch.full((6, 14), -1, dtype=torch.long)
for _cfg in range(6):
    _ids = [k for k in range(C) if TRUMP[_cfg, k]]
    _ids.sort(key=lambda k: -int(POWER[_cfg, k]))
    TOP[_cfg, :len(_ids)] = torch.tensor(_ids)


class Deals:
    """A batch of deals. `hands` [B, 4, 32] bool; `dealer` [B]."""

    def __init__(self, hands, dealer):
        dev = hands.device; B = hands.shape[0]
        self.dev, self.B = dev, B
        self.t = {k: v.to(dev) for k, v in dict(TRUMP=TRUMP, FOLLOW=FOLLOW, POWER=POWER, PTS=PTS, TOP=TOP).items()}
        self.hands = hands.clone(); self.dealt = hands.clone()
        self.dealer = dealer.to(dev).long()
        z = lambda: torch.zeros(B, dtype=torch.long, device=dev)
        self.step = z(); self.turn = (self.dealer + 1) % 4; self.said = z()
        self.call_type = z(); self.call_seat = z(); self.call_arg = z()        # 0 none, 1 Sauspiel, 2 Wenz, 3 Solo
        self.cfg = z(); self.declarer = z(); self.partner = z() - 1; self.ace = z() - 1
        self.trick = torch.full((B, 4), -1, dtype=torch.long, device=dev); self.trick_len = z(); self.leader = z()
        self.tricks = z(); self.won_pts = torch.zeros(B, 4, dtype=torch.long, device=dev); self.won_tricks = torch.zeros(B, 4, dtype=torch.long, device=dev)
        self.thrown = torch.zeros(B, dtype=torch.bool, device=dev)
        self.payoff = torch.zeros(B, 4, device=dev)
        self.ar = torch.arange(B, device=dev)
        # the public record, for the views (sk_view_t.py): each card's trick (−1 unplayed), seat and time; each seat's bid
        self.card_trick = torch.full((B, C), -1, dtype=torch.long, device=dev)
        self.card_seat = torch.full((B, C), -1, dtype=torch.long, device=dev)
        self.card_time = torch.full((B, C), -1, dtype=torch.long, device=dev)
        self.plays = z()
        self.bid_of = torch.full((B, 4), -1, dtype=torch.long, device=dev)
        # who can still be the partner on the public record (sk-view.js publicPartner): the called ace fallen, a seat that
        # followed the called suit with another card, and a seat's leads from the called suit (checked at view time: running
        # away needs two more of the suit it may still have held)
        self.pub_can = torch.ones(B, 4, dtype=torch.bool, device=dev)
        self.ace_fell = torch.zeros(B, dtype=torch.bool, device=dev)
        self.run_card = torch.full((B, 4, 4), -1, dtype=torch.long, device=dev)
        self.run_time = torch.full((B, 4, 4), -1, dtype=torch.long, device=dev)
        self.run_n = torch.zeros(B, 4, dtype=torch.long, device=dev)

    # ------------------------------------------------------------------ legal moves
    def legal(self):
        """[B, 41] bool: the legal actions of the seat to move (none once over)."""
        L = torch.zeros(self.B, ACTIONS, dtype=torch.bool, device=self.dev)
        bid, play = self.step == STEP_BID, self.step == STEP_PLAY
        hand = self.hands[self.ar, self.turn]                                  # [B, 32]
        # bids: pass; Sauspiel only while nothing is said (callable aces); Wenz over a Sauspiel; Solo over both
        top = self.call_type
        L[:, C + BID_PASS] = bid
        S = suit.to(self.dev); R = rank.to(self.dev)
        for i, su in enumerate(SAU_SUITS):
            has_ace = hand[:, su * 8 + ACE]
            has_plain = (hand & (S == su) & (R != OBER) & (R != UNTER)).any(1)
            L[:, C + BID_SAU[i]] = bid & (top < 1) & ~has_ace & has_plain
        L[:, C + BID_WENZ] = bid & (top < 2)
        for su in range(4): L[:, C + BID_SOLO[su]] = bid & (top < 3)
        # cards
        F = self.t["FOLLOW"][self.cfg]                                          # [B, 32]
        sau = self.call_type_c == 1
        ace = self.ace.clamp(min=0)
        holds_ace = sau & hand[self.ar, ace] & (self.ace >= 0)
        ace_suit = torch.where(sau, ace // 8, torch.full_like(ace, -9))
        is_ace = torch.zeros_like(hand); is_ace[self.ar, ace] = sau
        lead = self.trick_len == 0
        # leading: the partner may not run from the called suit unless holding four of it
        of_suit = hand & (F == ace_suit[:, None])
        run_ban = holds_ace & (of_suit.sum(1) < 4)
        lead_ok = torch.where(run_ban[:, None], hand & ((F != ace_suit[:, None]) | is_ace), hand)
        # following
        first = self.trick[:, 0].clamp(min=0)
        led = F[self.ar, first]
        fol = hand & (F == led[:, None])
        can = fol.any(1)
        must_ace = holds_ace & (led == ace_suit)
        fol_ok = torch.where(must_ace[:, None], is_ace & hand, fol)
        free = torch.where((holds_ace & (hand.sum(1) > 1))[:, None], hand & ~is_ace, hand)
        follow_ok = torch.where(can[:, None], fol_ok, free)
        cards = torch.where(lead[:, None], lead_ok, follow_ok)
        L[:, :C] = cards & play[:, None]
        return L

    @property
    def call_type_c(self):
        """The contract's type once play has begun (1 Sauspiel, 2 Wenz, 3 Solo), 0 during bidding."""
        return torch.where(self.step >= STEP_PLAY, self.call_type, torch.zeros_like(self.call_type))

    # ------------------------------------------------------------------ one action for every deal
    def act(self, a):
        """Plays action `a` [B] for the seat to move in every deal still running (the caller passes legal actions)."""
        a = a.to(self.dev).long()
        bid = (self.step == STEP_BID) & (a >= C)
        play = (self.step == STEP_PLAY) & (a < C)
        if bid.any(): self._bid(bid, a - C)
        if play.any(): self._card(play, a.clamp(max=C - 1))

    def _bid(self, m, b):
        self.bid_of[self.ar[m], self.turn[m]] = b[m]
        self.said = torch.where(m, self.said + 1, self.said)
        said_play = m & (b != BID_PASS)
        typ = torch.where(b == BID_WENZ, 2, torch.where(b >= BID_SOLO[0], 3, 1))
        arg = torch.where(b >= BID_SOLO[0], b - BID_SOLO[0], torch.tensor(SAU_SUITS, device=self.dev)[(b - 1).clamp(0, 2)])
        self.call_type = torch.where(said_play, typ, self.call_type)
        self.call_seat = torch.where(said_play, self.turn, self.call_seat)
        self.call_arg = torch.where(said_play, arg, self.call_arg)
        done = m & (self.said >= 4)
        go = m & ~done
        self.turn = torch.where(go, (self.turn + 1) % 4, self.turn)
        thrown = done & (self.call_type == 0)
        self.thrown |= thrown
        self.step = torch.where(thrown, STEP_OVER, self.step)
        start = done & (self.call_type > 0)
        if start.any():
            ct = self.call_type
            cfg = torch.where(ct == 1, 0, torch.where(ct == 2, 1, 2 + self.call_arg))
            ace = torch.where(ct == 1, self.call_arg * 8 + ACE, torch.full_like(ct, -1))
            holder = self.dealt[self.ar, :, ace.clamp(min=0)].long().argmax(1)
            self.cfg = torch.where(start, cfg, self.cfg)
            self.declarer = torch.where(start, self.call_seat, self.declarer)
            self.ace = torch.where(start, ace, self.ace)
            self.partner = torch.where(start & (ct == 1), holder, self.partner)
            self.pub_can[self.ar[start], self.call_seat[start]] = False
            self.step = torch.where(start, STEP_PLAY, self.step)
            lead = (self.dealer + 1) % 4
            self.leader = torch.where(start, lead, self.leader)
            self.turn = torch.where(start, lead, self.turn)

    def _card(self, m, k):
        seat = self.turn
        self._partner_record(m, k, seat)
        idx = self.ar[m]
        self.card_trick[idx, k[m]] = self.tricks[m]
        self.card_seat[idx, k[m]] = seat[m]
        self.card_time[idx, k[m]] = self.plays[m]
        self.plays = torch.where(m, self.plays + 1, self.plays)
        hm = self.hands[self.ar, seat]
        hm[self.ar[m], k[m]] = False
        self.hands[self.ar, seat] = hm
        pos = self.trick_len
        self.trick[self.ar[m], pos[m]] = k[m]
        self.trick_len = torch.where(m, pos + 1, pos)
        full = m & (self.trick_len == 4)
        self.turn = torch.where(m & ~full, (seat + 1) % 4, self.turn)
        if full.any():
            P = self.t["POWER"][self.cfg]; F = self.t["FOLLOW"][self.cfg]
            tk = self.trick.clamp(min=0)
            led = F[self.ar, tk[:, 0]]
            pw = P.gather(1, tk)                                                # [B, 4]
            fl = F.gather(1, tk)
            trump = pw >= 100
            eff = torch.where(trump, pw, torch.where(fl == led[:, None], pw, torch.full_like(pw, -1)))
            # the first highest wins (no ties among distinct cards)
            win_i = eff.argmax(1)
            winner = (self.leader + win_i) % 4
            pts = self.t["PTS"][tk].sum(1)
            self.won_pts[self.ar[full], winner[full]] += pts[full]
            self.won_tricks[self.ar[full], winner[full]] += 1
            self.leader = torch.where(full, winner, self.leader)
            self.turn = torch.where(full, winner, self.turn)
            self.trick[full] = -1
            self.trick_len = torch.where(full, 0, self.trick_len)
            self.tricks = torch.where(full, self.tricks + 1, self.tricks)
            end = full & (self.tricks == 8)
            if end.any(): self._score(end)

    def _partner_record(self, m, k, seat):
        """The public partner record, before card `k` is played by `seat` (only while the called ace is out)."""
        sau = m & (self.call_type == 1) & ~self.ace_fell
        if not sau.any(): return
        ace = self.ace.clamp(min=0); asuit = ace // 8
        F = self.t["FOLLOW"][self.cfg]
        fk = F[self.ar, k]
        is_ace = k == ace
        fell = sau & is_ace
        self.pub_can[fell] = False
        self.pub_can[self.ar[fell], seat[fell]] = True
        self.ace_fell |= fell
        live = sau & ~is_ace & self.pub_can[self.ar, seat]
        first = self.trick[:, 0].clamp(min=0)
        led = F[self.ar, first]
        lead = self.trick_len == 0
        # following when the called suit was led, without the ace: never held it
        out = live & ~lead & (led == asuit)
        self.pub_can[self.ar[out], seat[out]] = False
        # leading the called suit (not the ace): held it only if running away; noted, checked at view time
        run = live & lead & (fk == asuit)
        if run.any():
            i, p = self.ar[run], seat[run]; n = self.run_n[i, p].clamp(max=3)
            self.run_card[i, p, n] = k[run]; self.run_time[i, p, n] = self.plays[run]
            self.run_n[i, p] = self.run_n[i, p] + 1

    def _score(self, m):
        B = self.B
        seats = torch.arange(4, device=self.dev)[None, :]
        side = (seats == self.declarer[:, None]) | ((self.call_type[:, None] == 1) & (seats == self.partner[:, None]))
        pts_side = (self.won_pts * side).sum(1); pts_opp = (self.won_pts * ~side).sum(1)
        tr_side = (self.won_tricks * side).sum(1); tr_opp = (self.won_tricks * ~side).sum(1)
        won = pts_side >= 61
        schneider = torch.where(won, pts_opp < 30, pts_side < 31)
        schwarz = torch.where(won, tr_opp == 0, tr_side == 0)
        sau, wenz = self.call_type == 1, self.call_type == 2
        base = torch.where(sau, 1, TARIFF_SOLO)
        # the Laufende: trumps from the top held unbroken by one side, in the dealt hands
        top = self.t["TOP"][self.cfg]                                           # [B, 14]
        valid = top >= 0
        held = (self.dealt.permute(0, 2, 1)[self.ar[:, None], top.clamp(min=0)] & side[:, None, :]).any(2)   # [B, 14] the side holds it
        same = (held == held[:, :1]) & valid
        run = torch.cumprod(same.long(), 1).sum(1)
        counted = torch.where(run >= torch.where(wenz, 2, 3), run, 0)
        amount = base + schneider.long() + schwarz.long() + counted
        sign = torch.where(won[:, None] == side, 1, -1)
        mult = torch.where(sau[:, None], torch.ones_like(side, dtype=torch.long), torch.where(side, 3, 1))
        delta = (sign * mult * amount[:, None]).float()
        self.payoff[m] = delta[m]
        self.step = torch.where(m, STEP_OVER, self.step)

    def over(self):
        return self.step == STEP_OVER


def deal_random(B, gen=None, device="cpu"):
    """B fresh deals: shuffled hands and a dealer."""
    perm = torch.argsort(torch.rand(B, C, generator=gen), 1)
    hands = torch.zeros(B, 4, C, dtype=torch.bool)
    hands[torch.arange(B)[:, None], (torch.arange(C) // 8)[None, :].expand(B, C), perm] = True
    dealer = torch.randint(0, 4, (B,), generator=gen)
    return Deals(hands.to(device), dealer)
