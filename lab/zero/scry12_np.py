"""Scry 1.2 on NumPy (16 Nov 2026; lab/zero/scry12.mjs says what it is). Rows from lab/zero/scry12-pack.mjs.

For each unknown card of the other hand: p = softmax(log(copies still unseen after the cards dealt before it) + f), with
f = W2 . ReLU(Wx x + Wa A_all/8 + Wt A_recent/4 + Wb A_since/4 + Ws sb + Wc dealt + b1) + b2, where A_w is the sum over a
window of the record of the event embeddings e = ReLU(We ev + be), learned with the rest. Trained with the cards in a random
order a position, each conditioned on the true names of the cards before it (teacher forcing), so at play it deals whole hands
one card after another. Loss: cross-entropy of each card's true name. Minibatches are whole records (a game seen by one seat),
so every window's events are in the batch. Held out: every fifth game (by seed), measured each epoch, the best kept.
Measured: the pool's odds, each card on its own (nothing dealt before it: what the policy reads), and the chain (the whole
hand, card after card: what the deal uses), in nats a card.
usage: python3 lab/zero/scry12_np.py <dir[,dir...]> <out.json> [--d 32] [--h 64] [--epochs 6] [--lr 1e-3] [--blocks 16]
"""
import argparse, json, os, sys, time
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("dir"); ap.add_argument("out")
ap.add_argument("--d", type=int, default=32); ap.add_argument("--h", type=int, default=64)
ap.add_argument("--epochs", type=int, default=6); ap.add_argument("--lr", type=float, default=1e-3)
ap.add_argument("--blocks", type=int, default=16); ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--init", default="")
ap.add_argument("--all", action="store_true")  # a quick check: train on every record and measure on the same
A = ap.parse_args()
say = lambda m: print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

# ---------- the rows, one folder after another (indices made global) ----------
EV, X, U, HOLD, WIN, SB, SA, SY, SR = [], [], [], [], [], [], [], [], []
ne = nr = 0
for d in A.dir.split(","):
    m = json.load(open(os.path.join(d, "meta.json"))); EVN, BX, SBN, NN = m["EV_N"], m["BX"], m["SB_N"], m["NN"]
    rd = lambda n, t: np.fromfile(os.path.join(d, n), dtype=t)
    EV.append(rd("ev.u8", np.uint8).reshape(-1, EVN)); X.append(np.memmap(os.path.join(d, "x.f32"), np.float32, "r").reshape(-1, BX))
    U.append(rd("u.f32", np.float32).reshape(-1, NN)); HOLD.append(rd("hold.u8", np.uint8) > 0)
    WIN.append(rd("win.i32", np.int32).reshape(-1, 3).astype(np.int64) + ne); SB.append(rd("sb.f32", np.float32).reshape(-1, SBN))
    SA.append(rd("sa.i32", np.int32).astype(np.int64) + ne); SY.append(rd("sy.i16", np.int16).astype(np.int64)); SR.append(rd("srow.i32", np.int32).astype(np.int64) + nr)
    ne += m["events"]; nr += m["rows"]
EV = np.concatenate(EV); U = np.concatenate(U); HOLD = np.concatenate(HOLD); WIN = np.concatenate(WIN)
SB = np.concatenate(SB); SA = np.concatenate(SA); SY = np.concatenate(SY); SR = np.concatenate(SR)
XS = X; XOFF = np.cumsum([0] + [len(x) for x in X])
def xrows(idx):  # rows of the position inputs across the folders' memmaps
    out = np.empty((len(idx), BX), np.float32)
    for f in range(len(XS)):
        sel = (idx >= XOFF[f]) & (idx < XOFF[f + 1])
        if sel.any(): out[sel] = XS[f][idx[sel] - XOFF[f]]
    return out

# records (blocks): a block's events [e0, e1), its rows [r0, r1), its slots [s0, s1); rows and slots are stored block by block
starts = WIN[:, 0]
bstart_rows = np.flatnonzero(np.r_[True, starts[1:] != starts[:-1]])
B_e0 = starts[bstart_rows]
ev_starts = np.unique(np.r_[B_e0, ne])
B_e1 = np.array([ev_starts[np.searchsorted(ev_starts, e, "right")] for e in B_e0])
B_r0 = bstart_rows; B_r1 = np.r_[bstart_rows[1:], nr]
slot_lo = np.searchsorted(SR, np.arange(nr), "left"); slot_hi = np.searchsorted(SR, np.arange(nr), "right")
B_s0 = slot_lo[B_r0]; B_s1 = np.r_[slot_lo[B_r0[1:]], len(SR)]
B_hold = HOLD[B_r0]
tr_b, he_b = np.flatnonzero(~B_hold), np.flatnonzero(B_hold)
if A.all: tr_b = he_b = np.arange(len(B_hold))
say(f"{len(B_e0)} records ({len(tr_b)} training, {len(he_b)} held out), {ne} events, {nr} positions, {len(SR)} unknown cards; {EVN} event numbers, {BX} + {SBN} inputs, {NN} names, d {A.d}, hidden {A.h}")

rng = np.random.default_rng(A.seed)
D, H = A.d, A.h
he_ = lambda n_in, *shape: rng.normal(0, np.sqrt(2 / n_in), shape).astype(np.float32)
P = dict(We=he_(EVN, EVN, D), be=np.zeros(D, np.float32), Wx=he_(BX, BX, H), Wa=he_(D, D, H) * 0.5, Wt=he_(D, D, H) * 0.5, Wb=he_(D, D, H) * 0.5,
         Ws=he_(SBN, SBN, H), Wc=he_(NN, NN, H) * 0.5, b1=np.zeros(H, np.float32), W2=np.zeros((H, NN), np.float32), b2=np.zeros(NN, np.float32))
if A.init:
    S0 = json.loads(open(A.init).readline())
    for k in P: P[k] = np.asarray(S0[k], np.float32).reshape(P[k].shape)
M = {k: np.zeros_like(v) for k, v in P.items()}; V2 = {k: np.zeros_like(v) for k, v in P.items()}

def batch(bs, order="random", train=True):
    """Forward (and, with train, backward) over the records bs. order: "random" (teacher forcing in a random order a position),
    "stored" (the hand's order), or "none" (nothing dealt before any card: each on its own)."""
    # events of the batch, local indices
    ev_idx = np.concatenate([np.arange(B_e0[b], B_e1[b]) for b in bs]); n = len(ev_idx)
    loc = {int(B_e0[b]): o for b, o in zip(bs, np.cumsum([0] + [int(B_e1[b] - B_e0[b]) for b in bs])[:-1])}
    rows = np.concatenate([np.arange(B_r0[b], B_r1[b]) for b in bs]); sl = np.concatenate([np.arange(B_s0[b], B_s1[b]) for b in bs])
    if not len(sl): return 0.0, 0
    off_row = np.concatenate([np.full(B_r1[b] - B_r0[b], loc[int(B_e0[b])] - B_e0[b]) for b in bs])
    Eb = EV[ev_idx].astype(np.float32) / 250
    pre = Eb @ P["We"] + P["be"]; e = np.maximum(pre, 0)
    C = np.zeros((n + 1, D), np.float32); C[1:] = np.cumsum(e, 0)
    a_ = WIN[rows, 0] + off_row; r_ = WIN[rows, 1] + off_row; b_ = WIN[rows, 2] + off_row
    Aall = (C[b_] - C[a_]) / 8; Arec = (C[b_] - C[r_]) / 4
    rowpos = np.searchsorted(rows, SR[sl])                       # each slot's row within the batch
    s_a = SA[sl] + off_row[rowpos]; Asin = (C[b_[rowpos]] - C[s_a]) / 4
    # the names dealt before each card
    Y = SY[sl]; S = len(sl); onehot = np.zeros((S, NN), np.float32); onehot[np.arange(S), Y] = 1
    if order == "none": Cc = np.zeros((S, NN), np.float32); perm = np.arange(S)
    else:
        key = rng.random(S) if order == "random" else np.arange(S, dtype=np.float64)
        perm = np.lexsort((key, rowpos)); oh = onehot[perm]; cs = np.cumsum(oh, 0) - oh
        first = np.r_[0, np.flatnonzero(rowpos[perm][1:] != rowpos[perm][:-1]) + 1]
        grp = np.repeat(np.arange(len(first)), np.diff(np.r_[first, S]))
        base = (cs[first] )  # cumulative before each group's first card
        Cp = cs - base[grp]; Cc = np.empty_like(Cp); Cc[perm] = Cp
    Xr = xrows(rows)
    pre_h = (Xr @ P["Wx"] + Aall @ P["Wa"] + Arec @ P["Wt"] + P["b1"])[rowpos] + Asin @ P["Wb"] + SB[sl] @ P["Ws"] + Cc @ P["Wc"]
    h = np.maximum(pre_h, 0)
    left = U[rows][rowpos] - Cc
    LP = np.where(left > 0, np.log(np.maximum(left, 1e-9)), -1e9).astype(np.float32)
    z = h @ P["W2"] + P["b2"] + LP; z -= z.max(1, keepdims=True); pz = np.exp(z); pz /= pz.sum(1, keepdims=True)
    loss = -np.log(pz[np.arange(S), Y] + 1e-9).sum()
    if not train: return float(loss), S
    g = {}
    dz = (pz - onehot) / S
    g["W2"] = h.T @ dz; g["b2"] = dz.sum(0)
    dh = (dz @ P["W2"].T) * (pre_h > 0)
    dhr = np.zeros((len(rows), H), np.float32); np.add.at(dhr, rowpos, dh)
    g["Wx"] = Xr.T @ dhr; g["Wa"] = Aall.T @ dhr; g["Wt"] = Arec.T @ dhr; g["b1"] = dh.sum(0)
    g["Wb"] = Asin.T @ dh; g["Ws"] = SB[sl].T @ dh; g["Wc"] = Cc.T @ dh
    dC = np.zeros((n + 1, D), np.float32)
    gA = dhr @ P["Wa"].T / 8; gR = dhr @ P["Wt"].T / 4; gS = dh @ P["Wb"].T / 4
    np.add.at(dC, b_, gA); np.add.at(dC, a_, -gA); np.add.at(dC, b_, gR); np.add.at(dC, r_, -gR)
    np.add.at(dC, b_[rowpos], gS); np.add.at(dC, s_a, -gS)
    de = np.cumsum(dC[::-1], 0)[::-1][1:]                         # de[j] = sum of dC[k], k > j
    dpre = de * (pre > 0)
    g["We"] = Eb.T @ dpre; g["be"] = dpre.sum(0)
    return float(loss), S, g

def measure(bs):
    out = {}
    for order in ("none", "stored"):
        L = n = 0
        for k in range(0, len(bs), 64):
            l, s = batch(bs[k:k + 64], order, train=False); L += l; n += s
        out[order] = L / max(1, n)
    # the pool's odds alone
    L = n = 0
    for b in bs:
        for r in range(B_r0[b], B_r1[b]):
            ss = np.arange(slot_lo[r], slot_hi[r]); u = U[r]
            L -= np.log(u[SY[ss]] / u.sum() + 1e-9).sum(); n += len(ss)
    out["pool"] = L / max(1, n)
    return out

t0 = time.time(); step = 0; lr = A.lr; b1_, b2_ = 0.9, 0.999
m0 = measure(he_b); say(f"before training: held out, nats a card: pool {m0['pool']:.4f}, each card {m0['none']:.4f}, whole hand {m0['stored']:.4f}")
best = (m0["stored"], {k: v.copy() for k, v in P.items()}, 0)
for ep in range(1, A.epochs + 1):
    order = rng.permutation(tr_b); tl = tn = 0
    for k in range(0, len(order), A.blocks):
        r = batch(order[k:k + A.blocks], "random")
        if len(r) < 3: continue
        l, s, g = r; tl += l; tn += s; step += 1
        for key in P:
            M[key] = b1_ * M[key] + (1 - b1_) * g[key]; V2[key] = b2_ * V2[key] + (1 - b2_) * g[key] ** 2
            P[key] -= lr * (M[key] / (1 - b1_ ** step)) / (np.sqrt(V2[key] / (1 - b2_ ** step)) + 1e-8)
    m = measure(he_b)
    say(f"epoch {ep}: training {tl / max(1, tn):.4f}; held out: pool {m['pool']:.4f}, each card {m['none']:.4f}, whole hand {m['stored']:.4f} ({time.time() - t0:.0f} s)")
    if m["stored"] < best[0]: best = (m["stored"], {k: v.copy() for k, v in P.items()}, ep)
    lr *= 0.8
P = best[1]
say(f"kept epoch {best[2]}: whole hand {best[0]:.4f} nats a card")
out = {"D": D, "H": H, "EV_N": EVN, "BX": BX, "SB_N": SBN, "NN": NN, **{k: np.round(v.astype(np.float64).ravel(), 5).tolist() for k, v in P.items()}}
os.makedirs(os.path.dirname(os.path.abspath(A.out)), exist_ok=True)
json.dump(out, open(A.out, "w"), separators=(",", ":"))
say(f"wrote {A.out}")
