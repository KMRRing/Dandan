"""
The GPU spike's cut-down Dandan as array maths: every game of a batch takes every step at once, a game the step
doesn't apply to masked out. Same rules and same random numbers as lab/gpu/mini.mjs (one game at a time, the way the
real engine is written), so from the same seeds both must give the same games (check()).

usage:  python mini.py bench          games per second on the GPU (and on the CPU) at batch sizes 1k to 1M
        python mini.py check FILE     the first games here against lab/gpu/mini.mjs's (node lab/gpu/mini.mjs 20000 FILE)
"""
import json, sys, time
import torch

I, D, L, C = 0, 1, 2, 3
MAX_TURNS = 60
M32 = 0xFFFFFFFF


def nxt(x):
    """xorshift32, as mini.mjs's next(), on a whole column of games (int64 holding uint32)."""
    x = x ^ ((x << 13) & M32)
    x = x ^ (x >> 17)
    x = x ^ ((x << 5) & M32)
    return x


class Games:
    def __init__(self, seeds, dev):
        B = len(seeds)
        self.B, self.dev = B, dev
        z = lambda *shape: torch.zeros(*shape, dtype=torch.int64, device=dev)
        sd = torch.as_tensor(seeds, dtype=torch.int64, device=dev)
        self.x = (sd * 2654435761) & M32
        self.x = torch.where(self.x == 0, torch.ones_like(self.x), self.x)
        deck = [I] * 26 + [D] * 12 + [L] * 10 + [C] * 12
        # int16: the library is most of the memory (64 cards a game), and 10 million games must fit in the card's 10 GB
        self.lib = torch.cat([torch.tensor(deck, dtype=torch.int16, device=dev).repeat(B, 1), torch.zeros(B, 4, dtype=torch.int16, device=dev)], 1)  # room to put back
        rows = torch.arange(B, device=dev)
        for a in range(59, 0, -1):            # Fisher–Yates from the top, as in mini.mjs
            self.x = nxt(self.x)
            b = self.x % (a + 1)
            va, vb = self.lib[:, a].clone(), self.lib[rows, b]
            self.lib[rows, b] = va
            self.lib[:, a] = vb
        self.p = torch.full((B,), 60, dtype=torch.int64, device=dev)
        self.hand, self.lands, self.mana = z(B, 2, 4), z(B, 2), z(B, 2)
        self.dan, self.sick = z(B, 2), z(B, 2)
        self.life = torch.full((B, 2), 20, dtype=torch.int64, device=dev)
        self.winner = torch.full((B,), -1, dtype=torch.int64, device=dev)
        self.turns = z(B)
        self.over = torch.zeros(B, dtype=torch.bool, device=dev)
        self.rows = rows
        for _ in range(7):
            for s in (0, 1):
                self.p -= 1
                self.hand[rows, s, self.lib[rows, self.p].long()] += 1

    def end(self, mask, winner, turn):
        self.over |= mask
        self.winner = torch.where(mask, torch.as_tensor(winner, device=self.dev), self.winner)
        self.turns = torch.where(mask, torch.as_tensor(turn, device=self.dev), self.turns)

    def draw(self, mask, s, turn):
        """One card for seat s in the games of mask; an empty library loses."""
        empty = mask & (self.p == 0)
        self.end(empty, 1 - s, turn)
        ok = mask & (self.p > 0)
        self.p -= ok.long()
        card = self.lib[self.rows, self.p.clamp(max=63)].long()
        self.hand[self.rows, s, card] += ok.long()

    def turn(self, t):
        a, o = t % 2, 1 - t % 2
        act = ~self.over
        al = act.long()
        self.mana[:, a] = torch.where(act, self.lands[:, a], self.mana[:, a])
        self.dan[:, a] += self.sick[:, a] * al
        self.sick[:, a] *= 1 - al
        self.draw(act, a, t)
        act = act & ~self.over
        land = act & (self.hand[:, a, I] > 0)
        ll = land.long()
        self.hand[:, a, I] -= ll; self.lands[:, a] += ll; self.mana[:, a] += ll
        stopped = torch.zeros_like(act)
        for _ in range(3):
            self.x = nxt(self.x); r1 = self.x
            self.x = nxt(self.x); r2 = self.x
            live = act & ~self.over & ~stopped
            can_d = live & (self.mana[:, a] >= 2) & (self.hand[:, a, D] > 0)
            can_c = live & (self.mana[:, a] >= 2) & (self.hand[:, a, C] > 0)
            n = can_d.long() + can_c.long()
            pick = r1 % (n + 1)
            stop = live & (pick == n)
            stopped |= stop
            cast = live & ~stop
            card = torch.where(can_d & (pick == 0), D, C)
            cl = cast.long()
            self.mana[:, a] -= 2 * cl
            self.hand[self.rows, a, card] -= cl
            counter = cast & (self.hand[:, o, L] > 0) & (self.mana[:, o] >= 2) & (r2 % 10 < 7)
            kl = counter.long()
            self.hand[:, o, L] -= kl; self.mana[:, o] -= 2 * kl
            at = self.p.clamp(max=63)
            self.lib[self.rows, at] = torch.where(counter, card.to(torch.int16), self.lib[self.rows, at])
            self.p += kl
            res = cast & ~counter
            self.sick[:, a] += (res & (card == D)).long()
            chart = res & (card == C)
            self.draw(chart, a, t)
            self.draw(chart & ~self.over, a, t)
        live = act & ~self.over
        att = live & (self.dan[:, a] > 0) & (self.lands[:, o] > 0)
        self.life[:, o] -= 4 * self.dan[:, a] * att.long()
        self.end(att & (self.life[:, o] <= 0), a, t)
        if t + 1 >= MAX_TURNS:
            self.end(act & ~self.over, 2, t + 1)

    def play(self):
        t = 0
        while t < MAX_TURNS and not bool(self.over.all()):
            self.turn(t)
            t += 1
        return self


def bench():
    gpu = torch.cuda.is_available()
    print(json.dumps({"torch": torch.__version__, "gpu": torch.cuda.get_device_name(0) if gpu else None, "cpu threads": torch.get_num_threads()}))
    for dev in (["cuda"] if gpu else []) + ["cpu"]:
        for B in [1_000, 10_000, 100_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000]:
            if dev == "cpu" and B > 100_000:
                continue
            if dev == "cuda" and B * 64 * 2 > 0.6 * torch.cuda.get_device_properties(0).total_memory:
                print(json.dumps({"engine": "torch cuda", "games": B, "skipped": "too big for the card's memory"}))
                continue
            seeds = torch.arange(1, B + 1, dtype=torch.int64, device=dev)
            Games(seeds[:1000], dev).play()                      # warm up
            if dev == "cuda": torch.cuda.synchronize()
            try:
                t0 = time.perf_counter()
                g = Games(seeds, dev).play()
                if dev == "cuda": torch.cuda.synchronize()
                sec = time.perf_counter() - t0
            except torch.cuda.OutOfMemoryError:
                print(json.dumps({"engine": "torch cuda", "games": B, "skipped": "ran out of the card's memory"}))
                break
            w = torch.bincount(g.winner, minlength=3).tolist()
            print(json.dumps({"engine": f"torch {dev}", "games": B, "seconds": round(sec, 3), "gamesPerSec": round(B / sec), "wins": w}))


def check(path):
    ref = [json.loads(l) for l in open(path) if l.strip()]
    seeds = [r["seed"] for r in ref]
    g = Games(seeds, "cpu").play()
    bad = 0
    for k, r in enumerate(ref):
        mine = {"winner": int(g.winner[k]), "turns": int(g.turns[k]), "life": g.life[k].tolist()}
        if mine != {"winner": r["winner"], "turns": r["turns"], "life": r["life"]}:
            bad += 1
            if bad <= 5: print("differs", r, mine)
    print(json.dumps({"checked": len(ref), "differ": bad}))
    return bad == 0


if __name__ == "__main__":
    if sys.argv[1:2] == ["check"]:
        sys.exit(0 if check(sys.argv[2]) else 1)
    bench()
