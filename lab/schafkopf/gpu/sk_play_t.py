"""Whole deals on the GPU (Fable's step 5): self-play and mixed-table matches, every seat's decision by the GPU search with its
engine's net, all deals of a batch in lockstep. The records are the JS jobs' (sk-selfplay.mjs, sk-match.mjs), with the starting
hands in Codex's card ids in place of a seed to replay from (sk-pack.mjs and sk-sum.mjs read both).

usage:
  python3 sk_play_t.py selfplay <out.jsonl> <deals> <seed> net=<net> [deals=256] [biddeals=1024] [device=cuda] [batch=<n>]
  python3 sk_play_t.py match <out.jsonl> <deals.jsonl> cand=<net> opp=<net> [noref=1|refonly=1] [deals=256] [biddeals=1024] ...
    <deals.jsonl>: {seed, hands, dealer} lines (gpu/deals.mjs makes them from the JS jobs' seeds, so the deals pair with theirs)
"""
import json, sys, time, torch
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sk_rules_t import Deals, C, deal_random
from sk_net_t import load
from sk_search_t import search
from sk_rng_t import mix

SAU = {33: 0, 34: 2, 35: 3}


def move_of(a):
    """An action as the JS move (key order as Codex builds them, so JSON.stringify matches)."""
    a = int(a)
    if a < C: return {"t": "card", "card": a + 1 + a // 8}
    if a == 32: return {"t": "pass"}
    if a in SAU: return {"t": "play", "type": "sau", "ace": SAU[a]}
    if a == 36: return {"t": "play", "type": "wenz"}
    return {"t": "play", "type": "solo", "suit": a - 37}


def key(a): return json.dumps(move_of(a), separators=(",", ":"))


def codex_hands(D, i):
    return [[k + 1 + k // 8 for k in D.dealt[i, p].nonzero().flatten().tolist()] for p in range(4)]


def play(D, nets, seat_engine, deals_card, deals_bid, keys, record=False):
    """Plays every deal of D to its end; seat_engine [B, 4] picks the net (index into nets) deciding for each seat. Returns the
    logs [[seat, action]] and, with record, each searched decision {i, seat, opts: [[key, mean, n]]}."""
    B = D.B
    logs = [[] for _ in range(B)]; decs = [[] for _ in range(B)]
    i = 0
    while not D.over().all():
        live = ~D.over(); L = D.legal(); k = L.sum(1); turn = D.turn.clone()
        act = L.long().argmax(1)
        multi = live & (k > 1)
        eng = seat_engine[D.ar, turn]
        for e in range(len(nets)):
            idx = (multi & (eng == e)).nonzero().flatten()
            if not idx.numel(): continue
            Ds = D.take(idx)
            best, means, cnt, _ = search(Ds, nets[e], deals_card, deals_bid, mix(keys[idx], i))
            act[idx] = best
            if record:
                for j, b in enumerate(idx.tolist()):
                    opts = [(a, float(means[j, a]), int(cnt[j, a])) for a in L[b].nonzero().flatten().tolist()]
                    opts.sort(key=lambda o: (o[0] != int(best[j]), -(o[1] if o[1] == o[1] else -9)))
                    decs[b].append({"i": len(logs[b]), "seat": int(turn[b]), "opts": [[key(a), round(m, 5) if m == m else None, n] for a, m, n in opts]})
        for b in live.nonzero().flatten().tolist(): logs[b].append([int(turn[b]), int(act[b])])
        D.act(act, live)
        i += 1
    return logs, decs


def contract_of(D, b):
    if bool(D.thrown[b]): return None
    t = int(D.call_type[b]); c = {"type": ["", "sau", "wenz", "solo"][t], "declarer": int(D.declarer[b])}
    if t == 1: c["partner"] = int(D.partner[b])
    return c


def role_of(D, b, seat):
    if bool(D.thrown[b]): return "thrown"
    if int(D.declarer[b]) == seat: return "declarer"
    return "partner" if int(D.call_type[b]) == 1 and int(D.partner[b]) == seat else "defender"


def main():
    mode, out = sys.argv[1], sys.argv[2]
    kv = dict(a.split("=", 1) for a in sys.argv[3:] if "=" in a)
    dev = kv.get("device", "cuda" if torch.cuda.is_available() else "cpu")
    dc, db = int(kv.get("deals", 256)), int(kv.get("biddeals", 1024))
    batch = int(kv.get("batch", 256))
    lines, t0 = [], time.time()
    if mode == "selfplay":
        # the seed may be a sum (a job's "<seed0>+{shard}"), so each shard plays its own deals
        n, seed = int(sys.argv[3]), sum(int(x) for x in sys.argv[4].split("+"))
        cpu_gen = torch.Generator().manual_seed(seed)
        net = load(kv["net"], dev)
        for start in range(0, n, batch):
            m = min(batch, n - start)
            D = deal_random(m, cpu_gen, dev)
            hands = [codex_hands(D, b) for b in range(m)]; dealer = D.dealer.tolist()
            logs, decs = play(D, [net], torch.zeros(m, 4, dtype=torch.long, device=dev), dc, db, mix(torch.arange(start, start + m, device=dev), seed), record=True)
            for b in range(m):
                lines.append({"seed": seed * 1000003 + start + b, "hands": hands[b], "dealer": dealer[b], "payoff": D.payoff[b].tolist(), "contract": contract_of(D, b),
                              "thrown": bool(D.thrown[b]), "log": [[s, move_of(a)] for s, a in logs[b]], "dec": decs[b]})
            open(out, "w").write("".join(json.dumps(l, separators=(",", ":")) + "\n" for l in lines))
            print(f"sk_play_t: {len(lines)} deals, {time.time() - t0:.0f}s", flush=True)
    elif mode == "match":
        deals = [json.loads(l) for l in open(sys.argv[3]) if l.startswith("{")]
        cand, opp = load(kv["cand"], dev), load(kv["opp"], dev)
        noref, refonly = kv.get("noref") == "1", kv.get("refonly") == "1"
        tables = ([-1] if not noref else []) + ([] if refonly else [0, 1, 2, 3])   # -1: four opp; k: cand in seat k
        for start in range(0, len(deals), max(1, batch // len(tables))):
            chunk = deals[start:start + max(1, batch // len(tables))]
            rows = [(d, t) for d in chunk for t in tables]
            H = torch.zeros(len(rows), 4, C, dtype=torch.bool)
            for r, (d, _) in enumerate(rows):
                for p, h in enumerate(d["hands"]): H[r, p, [x - 1 - (x - 1) // 9 for x in h]] = True
            D = Deals(H.to(dev), torch.tensor([d["dealer"] for d, _ in rows]))
            se = torch.ones(len(rows), 4, dtype=torch.long)
            for r, (_, t) in enumerate(rows):
                if t >= 0: se[r, t] = 0
            # a table's key: its deal's seed and which table it is, so every table of a deal searches the same worlds at a position
            logs, _ = play(D, [cand, opp], se.to(dev), dc, db, mix(torch.tensor([d["seed"] & 0xFFFFFFFF for d, _ in rows], device=dev), 7))
            for d in chunk:
                ref = next((r for r, (dd, t) in enumerate(rows) if dd is d and t == -1), None)
                p0 = D.payoff[ref].tolist() if ref is not None else None
                seats = []
                for r, (dd, t) in enumerate(rows):
                    if dd is not d or t < 0: continue
                    p = D.payoff[r].tolist()
                    seats.append({"me": t, "payoff": p[t], "diff": round(p[t] - p0[t], 4) if p0 else None, "role": role_of(D, r, t), "contract": contract_of(D, r),
                                  "log": [[s, move_of(a)] for s, a in logs[r]]})
                line = {"seed": d["seed"], "hands": d["hands"], "dealer": d["dealer"], "seats": seats}
                if p0 is not None:
                    line["ref"] = {"payoff": p0, "role": [role_of(D, ref, p) for p in range(4)], "contract": contract_of(D, ref), "log": [[s, move_of(a)] for s, a in logs[ref]]}
                lines.append(line)
            open(out, "w").write("".join(json.dumps(l, separators=(",", ":")) + "\n" for l in lines))
            print(f"sk_play_t: {len(lines)} paired deals, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
