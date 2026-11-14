"""Zero's belief net on NumPy (14 Nov 2026, Korbi 10:02, 10:19): one distribution over names for each unknown card in the other
hand. A card's chance by name p = softmax(log unseen + f(x, slot)), f = W2 · ReLU(Wg x + Ws slot + b1) + b2, x the position
(lab/zero/zero-view.mjs beliefInput, BX numbers, read once a position) and slot that card's own history (SLOT_N: from the
opening hand after how many mulligans, drawn when, land drops skipped since…). Untrained (W2 = 0) it is the unseen pool's odds.
Loss: the cross-entropy of what each card really was. Adam, the held-out rows (every fifth game) measured each epoch, the best
kept; the pool's odds alone measured too; and the land check Korbi asked for: how well the chance of two or more lands among
the unknown cards is called (Brier score, against the pool's odds). Written as { H, Wg, Ws, b1, W2, b2 } for beliefOf.
usage: python3 lab/zero/belief_np.py <packed folder (replay-pack.mjs belief: <dir>/b)> <out> [--h 64] [--epochs 6] [--lr 1e-3]
"""
import argparse, json, os, time
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("dir"); ap.add_argument("out")
ap.add_argument("--h", type=int, default=64); ap.add_argument("--epochs", type=int, default=6)
ap.add_argument("--lr", type=float, default=1e-3); ap.add_argument("--batch", type=int, default=256); ap.add_argument("--seed", type=int, default=1)
A = ap.parse_args()
say = lambda m: print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)
meta = json.load(open(os.path.join(A.dir, "meta.json"))); BX, NN, SN, R, S = meta["BX"], meta["NN"], meta["SLOT_N"], meta["rows"], meta["slots"]
rd = lambda n, t: np.fromfile(os.path.join(A.dir, n), dtype=t)
X, U, HOLD = rd("x.f32", np.float32).reshape(R, BX), rd("u.f32", np.float32).reshape(R, NN), rd("hold.u8", np.uint8) > 0
SF, SY, SR = rd("sf.f32", np.float32).reshape(S, SN), rd("sy.i16", np.int16).astype(np.int64), rd("srow.i32", np.int32).astype(np.int64)
LP = np.where(U > 0, np.log(np.maximum(U, 1e-9)), -1e9).astype(np.float32)
LANDS = np.array(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lands.json"))), bool) if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lands.json")) else np.zeros(NN, bool)
sh = HOLD[SR]; tr, he = np.flatnonzero(~sh), np.flatnonzero(sh)
rng = np.random.default_rng(A.seed)
P = dict(Wg=rng.normal(0, np.sqrt(2 / BX), (BX, A.h)).astype(np.float32), Ws=rng.normal(0, np.sqrt(2 / SN), (SN, A.h)).astype(np.float32),
         b1=np.zeros(A.h, np.float32), W2=np.zeros((A.h, NN), np.float32), b2=np.zeros(NN, np.float32))
M = {k: np.zeros_like(v) for k, v in P.items()}; Vv = {k: np.zeros_like(v) for k, v in P.items()}
say(f"{R} positions, {S} unknown cards ({len(tr)} training, {len(he)} held out), {BX} + {SN} inputs, {NN} names, hidden {A.h}")

def fwd(j, P, prior=False):
    if prior: z = LP[SR[j]].copy()
    else:
        h = np.maximum(X[SR[j]] @ P["Wg"] + SF[j] @ P["Ws"] + P["b1"], 0)
        z = h @ P["W2"] + P["b2"] + LP[SR[j]]
    z -= z.max(1, keepdims=True); e = np.exp(z); p = e / e.sum(1, keepdims=True)
    return (None if prior else h), p

def measure(idx, P, prior=False):
    tot, rows_p = 0.0, {}
    for s in range(0, len(idx), 65536):
        j = idx[s:s + 65536]; p = fwd(j, P, prior)[1]
        tot += -np.log(p[np.arange(len(j)), SY[j]] + 1e-9).sum()
        pl = p[:, LANDS].sum(1) if LANDS.any() else np.zeros(len(j)); yl = LANDS[SY[j]] if LANDS.any() else np.zeros(len(j), bool)
        for r, a, b in zip(SR[j], pl, yl): rows_p.setdefault(int(r), []).append((float(a), bool(b)))
    # P(two or more lands among a position's unknown cards), slots taken one by one (independent), against what was there
    br = []
    for v in rows_p.values():
        dist = np.array([1.0])
        for a, _ in v: dist = np.convolve(dist, [1 - a, a])
        br.append((dist[2:].sum() - (sum(b for _, b in v) >= 2)) ** 2)
    return tot / max(1, len(idx)), float(np.mean(br)) if br else 0.0

prior, pbr = measure(he, P, True)
best, bbr = measure(he, P); bestP = {k: v.copy() for k, v in P.items()}; t = 0
say(f"the pool's odds alone: held-out loss {prior:.4f} a card; two-or-more-lands Brier {pbr:.4f}")
for e in range(1, A.epochs + 1):
    order = rng.permutation(tr)
    for s in range(0, len(order), A.batch):
        j = order[s:s + A.batch]; t += 1
        h, p = fwd(j, P)
        gz = p.copy(); gz[np.arange(len(j)), SY[j]] -= 1; gz /= len(j)
        G = dict(W2=h.T @ gz, b2=gz.sum(0))
        gh = (gz @ P["W2"].T) * (h > 0)
        G["Wg"] = X[SR[j]].T @ gh; G["Ws"] = SF[j].T @ gh; G["b1"] = gh.sum(0)
        for k in P:
            M[k] = 0.9 * M[k] + 0.1 * G[k]; Vv[k] = 0.999 * Vv[k] + 0.001 * G[k] ** 2
            P[k] -= A.lr * (M[k] / (1 - 0.9 ** t)) / (np.sqrt(Vv[k] / (1 - 0.999 ** t)) + 1e-8)
    l, br = measure(he, P)
    say(f"epoch {e}: held-out loss {l:.4f} a card; two-or-more-lands Brier {br:.4f}")
    if l < best: best, bbr, bestP = l, br, {k: v.copy() for k, v in P.items()}
r5 = lambda a: [round(float(v), 5) for v in a.ravel()]
json.dump(dict(source="lab/zero/belief_np.py", H=A.h, BX=BX, SLOT_N=SN, NN=NN, **{k: r5(v) for k, v in bestP.items()},
               metrics=dict(heldLoss=round(float(best), 4), priorLoss=round(float(prior), 4), landBrier=round(bbr, 4), priorLandBrier=round(pbr, 4), positions=int(R), cards=int(S))), open(A.out, "w"))
open(A.out, "a").write("\n")
say(f"best held-out loss {best:.4f} a card against the pool's odds {prior:.4f}; two-or-more-lands Brier {bbr:.4f} against {pbr:.4f}")
