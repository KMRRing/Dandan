# Scry G's training (17 Nov 2026; the general dealer, lab/zero/scryg.mjs): the rows of lab/zero/scryg-pack.mjs (one folder or
# several), the net as scryg.mjs reads it, trained on the true cards card by card (each position's cards in a random order, each
# card's odds given those before it: the chain), every fifth game held out. Reported each epoch on the held-out games: the chain's
# and the single card's −log chance (nats a card), and the calibration (the chance given against how often it was right, in ten
# buckets). Written: <out> (the export, JSON) and <out>.log.json (the measures).
# usage: python3 lab/zero/scryg_torch.py <out.json> <dir> [<dir> …] [--epochs 6] [--d 32] [--a 32] [--h 128] [--init net.json]
import argparse, json, os, sys, time, math
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as Fn

ap = argparse.ArgumentParser()
ap.add_argument("out"); ap.add_argument("dirs", nargs="+")
ap.add_argument("--epochs", type=int, default=6); ap.add_argument("--lr", type=float, default=1e-3); ap.add_argument("--wd", type=float, default=1e-4)
ap.add_argument("--d", type=int, default=32); ap.add_argument("--a", type=int, default=32); ap.add_argument("--h", type=int, default=128)
ap.add_argument("--bs", type=int, default=128); ap.add_argument("--seed", type=int, default=1); ap.add_argument("--init", default="")
# --aux_counts <w> (19 Nov 2026, Korbi: the dealer's extra outputs): a training-only head on the position's summary predicting how
# many of the hidden hand's cards fall in each of the packer's rule-defined groups (gc.u8: lands, cycling, answers, instant speed,
# library effects), squared error on count / 3 at weight w; not exported, so the dealer the search uses is unchanged in shape
ap.add_argument("--aux_counts", "--aux-counts", dest="aux_counts", type=float, default=0.0)
ap.add_argument("--threads", type=int, default=0); ap.add_argument("--all", action="store_true")  # a quick check: train and measure on every row
A = ap.parse_args()
torch.manual_seed(A.seed); np.random.seed(A.seed)
if A.threads: torch.set_num_threads(A.threads)
t0 = time.time()
say = lambda *a: print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)

# ---------- the rows ----------
cat = lambda xs: np.concatenate(xs) if xs else np.zeros(0)
EVo, EVm, EVc, EVt, Xo, Xi, Xv, U, NH, NL, Yo, Y, REC, TURN, HOLD, GC = ([] for _ in range(16))
ne = nm = nx = ny = 0
meta0 = None
for d in A.dirs:
    m = json.load(open(os.path.join(d, "meta.json")))
    if meta0 and any(m[k] != meta0[k] for k in ("V", "MARK_N", "CTX_N", "EV", "X")): sys.exit(f"{d}: sizes differ")
    meta0 = meta0 or m
    rd = lambda n, t: np.fromfile(os.path.join(d, n), dtype=t)
    if m["rows"] == 0: continue
    EVo.append(rd("ev_off.i64", np.int64)[:-1] + nm); EVm.append(rd("ev_marks.u16", np.uint16)); EVc.append(rd("ev_ctx.u8", np.uint8).reshape(-1, m["CTX_N"])); EVt.append(rd("ev_turn.i16", np.int16))
    Xo.append(rd("x_off.i64", np.int64)[:-1] + nx); Xi.append(rd("x_idx.u16", np.uint16)); Xv.append(rd("x_val.f16", np.float16))
    U.append(rd("u.u8", np.uint8).reshape(-1, m["V"])); NH.append(rd("nh.u8", np.uint8)); NL.append(rd("nl.u8", np.uint8))
    Yo.append(rd("y_off.i64", np.int64)[:-1] + ny); Y.append(rd("y.u8", np.uint8))
    REC.append(rd("rec.i64", np.int64).reshape(-1, 2) + ne); TURN.append(rd("turn.i16", np.int16)); HOLD.append(rd("hold.u8", np.uint8) > 0)
    GC.append(rd("gc.u8", np.uint8).reshape(-1, len(m["groups"])) if os.path.exists(os.path.join(d, "gc.u8")) else None)
    ne += m["events"]; nm += m["marks"]; nx += m["xnz"]; ny += m["targets"]
V, MARK_N, CTX_N, EVN, X = meta0["V"], meta0["MARK_N"], meta0["CTX_N"], meta0["EV"], meta0["X"]
EVo, EVm, EVc, EVt = cat(EVo), cat(EVm).astype(np.int64), cat(EVc), cat(EVt).astype(np.int64)
EVend = np.r_[EVo[1:], nm]
Xo, Xi, Xv = cat(Xo), cat(Xi).astype(np.int64), cat(Xv).astype(np.float32); Xend = np.r_[Xo[1:], nx]
U, NH, NL, Yo, Y = cat(U).astype(np.float32), cat(NH), cat(NL), cat(Yo), cat(Y).astype(np.int64); Yend = np.r_[Yo[1:], ny]
REC, TURN, HOLD = cat(REC), cat(TURN).astype(np.int64), cat(HOLD)
GROUPS = meta0.get("groups") or []
GC = np.concatenate(GC).astype(np.float32) if GROUPS and GC and all(g is not None for g in GC) else None
if A.aux_counts and GC is None: say("WARNING: --aux_counts asked for, but the packs have no gc.u8: trained without it")
R = len(U)
tr, he = np.flatnonzero(~HOLD), np.flatnonzero(HOLD)
if A.all: tr = he = np.arange(R)
say(f"{R} positions ({len(tr)} training, {len(he)} held out), {ne} events, {ny} cards to guess; V {V}, marks {MARK_N}, input {X}; d {A.d} a {A.a} h {A.h}")

# ---------- the net (as scryg.mjs reads it) ----------
class Net(nn.Module):
    def __init__(s):
        super().__init__()
        D, AA, H = A.d, A.a, A.h
        s.bag = nn.EmbeddingBag(MARK_N, D, mode="sum"); s.ctx = nn.Linear(CTX_N, D)   # the event's layer: We = [bag | ctx], be = ctx.bias
        s.Wk = nn.Linear(D, AA, bias=False); s.wa = nn.Parameter(torch.zeros(AA)); s.Wv = nn.Linear(D, D, bias=False)
        s.Wx = nn.Linear(X, H); s.Wq = nn.Linear(H, AA, bias=False)
        s.W1 = nn.Linear(H + 2 * D, H); s.Wc = nn.Linear(V, H, bias=False); s.W2 = nn.Linear(H, V)
        nn.init.zeros_(s.W2.weight); nn.init.zeros_(s.W2.bias)   # untrained: the unseen pool's odds
        s.Gc = nn.Linear(H, max(1, len(GROUPS)))   # the group counts (training only, not exported)
    def events(s, idx):
        """Embeddings of events `idx` (global): e = ReLU(bag(marks) + ctx·W + b)."""
        lo, hi = EVo[idx], EVend[idx]
        flat = np.concatenate([EVm[a:b] for a, b in zip(lo, hi)]) if len(idx) else np.zeros(0, np.int64)
        offs = np.r_[0, np.cumsum(hi - lo)[:-1]]
        e = s.bag(torch.from_numpy(flat), torch.from_numpy(offs)) + s.ctx(torch.from_numpy(EVc[idx].astype(np.float32) / 250))
        return Fn.relu(e)
    def forward(s, rows):
        B = len(rows); H, D, AA = A.h, A.d, A.a
        # the positions
        x = torch.zeros(B, X)
        for b, r in enumerate(rows):
            x[b, torch.from_numpy(Xi[Xo[r]:Xend[r]])] = torch.from_numpy(Xv[Xo[r]:Xend[r]])
        h0 = Fn.relu(s.Wx(x)); q = s.Wq(h0)
        # the records: each position reads its record's events so far
        lens = [int(REC[r, 1] - REC[r, 0]) for r in rows]; T = max(1, max(lens))
        ev = np.concatenate([np.arange(REC[r, 0], REC[r, 1]) for r in rows]) if sum(lens) else np.zeros(0, np.int64)
        E = s.events(ev) if len(ev) else torch.zeros(0, D)
        Ep = torch.zeros(B, T, D); age = torch.zeros(B, T); msk = torch.zeros(B, T, dtype=torch.bool)
        k = 0
        for b, r in enumerate(rows):
            n = lens[b]
            if n:
                Ep[b, :n] = E[k:k + n]; age[b, :n] = torch.from_numpy(np.minimum(20, TURN[r] - EVt[REC[r, 0]:REC[r, 1]]).astype(np.float32) / 10); msk[b, :n] = True
            k += n
        K = s.Wk(Ep) + age.unsqueeze(-1) * s.wa; Vv = s.Wv(Ep)
        sc = (K * q.unsqueeze(1)).sum(-1) / math.sqrt(AA)
        sc = sc.masked_fill(~msk, -1e9); al = torch.softmax(sc, -1) * msk
        c = (al.unsqueeze(-1) * Vv).sum(1)
        mean = (Ep * msk.unsqueeze(-1)).sum(1) / torch.clamp(msk.sum(1, keepdim=True), min=1)
        return s.W1(torch.cat([h0, c, mean], -1))
    def logits(s, g, dealt, u):
        """Each card's log odds: g (N×H), dealt (N×V) the cards before it, u (N×V) the unseen copies (the mask)."""
        h = Fn.relu(g + s.Wc(dealt / 4))
        left = u - dealt
        return s.W2(h) + torch.where(left > 0, torch.log(torch.clamp(left, min=1e-9)), torch.full_like(left, -1e9))

net = Net()
if A.init:
    say("warm start from", A.init)   # same sizes: the export read back (lab/zero/scryg.mjs's layout)
    j = json.load(open(A.init)); T_ = lambda k, shp: torch.tensor(j[k], dtype=torch.float32).reshape(shp)
    with torch.no_grad():
        We = T_("We", (A.d, EVN)); net.bag.weight.copy_(We[:, :MARK_N].T); net.ctx.weight.copy_(We[:, MARK_N:]); net.ctx.bias.copy_(T_("be", (A.d,)))
        for nm_, mod in (("Wk", net.Wk), ("Wv", net.Wv), ("Wq", net.Wq), ("Wc", net.Wc)): mod.weight.copy_(T_(nm_, mod.weight.shape))
        # the position's input grown (17 Nov 2026: sg1 read view 1, 1,259 + V + 2 inputs; view 2 reads 2,602 + V + 2): the view's
        # columns kept where they were, the last V + 2 (the unseen copies, the hand and library counts) moved to the end, the new
        # view-2 columns zero, so the grown net starts out computing what the old one did
        wx = torch.tensor(j["Wx"], dtype=torch.float32); H_, X_ = net.Wx.weight.shape
        if wx.numel() != H_ * X_:
            X0 = wx.numel() // H_; old = wx.reshape(H_, X0); E = V + 2; grown = torch.zeros(H_, X_)
            grown[:, :X0 - E] = old[:, :X0 - E]; grown[:, X_ - E:] = old[:, X0 - E:]
            say(f"input grown from {X0} to {X_}"); net.Wx.weight.copy_(grown)
        else: net.Wx.weight.copy_(wx.reshape(H_, X_))
        net.Wx.bias.copy_(T_("bx", net.Wx.bias.shape))
        for nm_, mod in (("W1", net.W1), ("W2", net.W2)): mod.weight.copy_(T_(nm_, mod.weight.shape)); mod.bias.copy_(T_({"W1": "b1", "W2": "b2"}[nm_], mod.bias.shape))
        net.wa.copy_(T_("wa", (A.a,)))
opt = torch.optim.AdamW(net.parameters(), lr=A.lr, weight_decay=A.wd)

def chain_batch(rows, g, order_seed):
    """The chain's rows for positions `rows` (g their hidden shares): each true card with the cards before it (a random order)."""
    rng = np.random.default_rng(order_seed)
    G, D_, Uu, Yy, first = [], [], [], [], []
    for b, r in enumerate(rows):
        ys = Y[Yo[r]:Yend[r]].copy(); rng.shuffle(ys)
        dealt = np.zeros(V, np.float32)
        for j, y in enumerate(ys):
            G.append(b); D_.append(dealt.copy()); Uu.append(U[r]); Yy.append(y); first.append(j == 0); dealt[y] += 1
    return torch.tensor(G), torch.from_numpy(np.stack(D_)), torch.from_numpy(np.stack(Uu)), torch.tensor(Yy), np.array(first)

def measure(rows, bs=256):
    """Held-out: the chain's and the single card's −log chance (nats a card), and the calibration: a position's single-card odds
    of each name against the share of its true cards that are that name, in ten buckets of the odds (predicted, observed, n)."""
    net.eval(); chain = each = 0.0; n = 0; cal = np.zeros((10, 3))
    with torch.no_grad():
        for i in range(0, len(rows), bs):
            rr = rows[i:i + bs]; g = net(rr)
            gi, dl, uu, yy, first = chain_batch(rr, g, 7 + i)
            lp = torch.log_softmax(net.logits(g[gi], dl, uu), -1); chain -= lp.gather(1, yy[:, None]).sum().item()
            p1 = torch.softmax(net.logits(g[gi], torch.zeros_like(dl), uu), -1)
            each -= torch.log(p1.gather(1, yy[:, None]) + 1e-9).sum().item(); n += len(yy)
            pf = p1.numpy()[first]
            for b, r in enumerate(rr):
                ys = Y[Yo[r]:Yend[r]]; share = np.bincount(ys, minlength=V) / len(ys); pr = pf[b]; bi = np.minimum(9, (pr * 10).astype(int))
                np.add.at(cal[:, 0], bi, pr); np.add.at(cal[:, 1], bi, share); np.add.at(cal[:, 2], bi, 1)
    gerr = None
    if A.aux_counts and GC is not None:
        with torch.no_grad():
            pr = np.concatenate([net.Gc(Fn.relu(net(rows[i:i + bs]))).numpy() * 3 for i in range(0, len(rows), bs)])
        gerr = {k: round(float(np.abs(pr[:, j] - GC[rows][:, j]).mean()), 3) for j, k in enumerate(GROUPS)}
    net.train()
    calib = [[round(float(cal[k, 0] / cal[k, 2]), 3), round(float(cal[k, 1] / cal[k, 2]), 3), int(cal[k, 2])] for k in range(10) if cal[k, 2]]
    return {"chain": round(chain / max(1, n), 4), "each": round(each / max(1, n), 4), "cards": n, "calibration": calib, **({"groupMAE": gerr} if gerr else {})}

log = {"positions": int(R), "train": int(len(tr)), "held": int(len(he)), "epochs": []}
say("untrained:", measure(he))
for ep in range(A.epochs):
    perm = np.random.permutation(tr); tot = 0.0; cards = 0
    for i in range(0, len(perm), A.bs):
        rr = perm[i:i + A.bs]; g = net(rr)
        gi, dl, uu, yy, _ = chain_batch(rr, g, ep * 1000003 + i)
        loss = Fn.cross_entropy(net.logits(g[gi], dl, uu), yy)
        if A.aux_counts and GC is not None: loss = loss + A.aux_counts * Fn.mse_loss(net.Gc(Fn.relu(g)), torch.from_numpy(GC[rr] / 3))
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(net.parameters(), 1.0); opt.step()
        tot += loss.item() * len(yy); cards += len(yy)
    mm = measure(he); mm["epoch"] = ep + 1; mm["train"] = round(tot / max(1, cards), 4); log["epochs"].append(mm)
    say(f"epoch {ep + 1}: train {mm['train']}, held-out chain {mm['chain']} each {mm['each']} ({mm['cards']} cards), {time.time() - t0:.0f} s")

# ---------- the export ----------
L = lambda t: [round(float(v), 6) for v in t.detach().reshape(-1).tolist()]
with torch.no_grad():
    We = torch.cat([net.bag.weight.T, net.ctx.weight], 1)   # D × (MARK_N + CTX_N)
    out = {"scryg": 1, "V": V, "EV": EVN, "X": X, "D": A.d, "A": A.a, "H": A.h, "We": L(We), "be": L(net.ctx.bias), "Wk": L(net.Wk.weight), "wa": L(net.wa),
           "Wv": L(net.Wv.weight), "Wx": L(net.Wx.weight), "bx": L(net.Wx.bias), "Wq": L(net.Wq.weight), "W1": L(net.W1.weight), "b1": L(net.W1.bias),
           "Wc": L(net.Wc.weight), "W2": L(net.W2.weight), "b2": L(net.W2.bias), "measures": log}
json.dump(out, open(A.out, "w")); json.dump(log, open(A.out + ".log.json", "w"), indent=1)
say(f"wrote {A.out} ({os.path.getsize(A.out) / 1e6:.1f} MB)")
