"""Zero's belief net on NumPy (14 Nov 2026, Korbi 10:02/10:04): the other hand's unknown cards by name. Each unknown slot's
chance by name p = softmax(log unseen + f(x)), f an MLP (x: lab/zero/zero-view.mjs beliefInput, BX numbers; ReLU hidden layer;
linear out, one number a name), so an untrained net is the unseen pool's own odds. Loss: the cross-entropy of the cards that
were really there (y, by name) under p, per card. Adam, the held-out rows (every fifth game) measured each epoch, the best kept;
the prior alone (f = 0) measured too, so the gain is plain. Written as { H, W1, b1, W2, b2 } for zero-view.mjs beliefOf.
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
meta = json.load(open(os.path.join(A.dir, "meta.json"))); BX, NN, R = meta["BX"], meta["NN"], meta["rows"]
rd = lambda n, t: np.fromfile(os.path.join(A.dir, n), dtype=t)
X, Y, U, H = rd("x.f32", np.float32).reshape(R, BX), rd("y.f32", np.float32).reshape(R, NN), rd("u.f32", np.float32).reshape(R, NN), rd("hold.u8", np.uint8) > 0
LP = np.where(U > 0, np.log(np.maximum(U, 1e-9)), -1e9).astype(np.float32)
tr, he = np.flatnonzero(~H), np.flatnonzero(H)
rng = np.random.default_rng(A.seed)
P = dict(W1=rng.normal(0, np.sqrt(2 / BX), (BX, A.h)).astype(np.float32), b1=np.zeros(A.h, np.float32),
         W2=np.zeros((A.h, NN), np.float32), b2=np.zeros(NN, np.float32))
M = {k: np.zeros_like(v) for k, v in P.items()}; Vv = {k: np.zeros_like(v) for k, v in P.items()}
say(f"{R} rows ({len(tr)} training, {len(he)} held out), {BX} inputs, {NN} names, hidden {A.h}")

def fwd(j, P):
    h = np.maximum(X[j] @ P["W1"] + P["b1"], 0)
    z = h @ P["W2"] + P["b2"] + LP[j]
    z -= z.max(1, keepdims=True)
    e = np.exp(z); p = e / e.sum(1, keepdims=True)
    return h, p

def loss_of(idx, P, prior=False):
    tot, n, mae = 0.0, 0.0, 0.0
    for s in range(0, len(idx), 65536):
        j = idx[s:s + 65536]
        if prior:
            z = LP[j] - LP[j].max(1, keepdims=True); e = np.exp(z); p = e / e.sum(1, keepdims=True)
        else:
            p = fwd(j, P)[1]
        tot += -(Y[j] * np.log(p + 1e-9)).sum(); n += Y[j].sum()
        mae += np.abs(p * Y[j].sum(1, keepdims=True) - Y[j]).sum()
    return tot / max(n, 1), mae / max(len(idx), 1)

prior, pmae = loss_of(he, P, True)
best, bmae = loss_of(he, P); bestP = {k: v.copy() for k, v in P.items()}; t = 0
say(f"the unseen pool's odds alone: held-out loss {prior:.4f} a card, {pmae:.3f} cards off a hand")
for e in range(1, A.epochs + 1):
    order = rng.permutation(tr)
    for s in range(0, len(order), A.batch):
        j = order[s:s + A.batch]; t += 1
        h, p = fwd(j, P)
        n = Y[j].sum(1, keepdims=True)
        gz = (p * n - Y[j]) / max(n.sum(), 1)
        G = dict(W2=h.T @ gz, b2=gz.sum(0))
        gh = (gz @ P["W2"].T) * (h > 0)
        G["W1"] = X[j].T @ gh; G["b1"] = gh.sum(0)
        for k in P:
            M[k] = 0.9 * M[k] + 0.1 * G[k]; Vv[k] = 0.999 * Vv[k] + 0.001 * G[k] ** 2
            P[k] -= A.lr * (M[k] / (1 - 0.9 ** t)) / (np.sqrt(Vv[k] / (1 - 0.999 ** t)) + 1e-8)
    l, mae = loss_of(he, P)
    say(f"epoch {e}: held-out loss {l:.4f} a card, {mae:.3f} cards off a hand")
    if l < best: best, bmae, bestP = l, mae, {k: v.copy() for k, v in P.items()}
r5 = lambda a: [round(float(v), 5) for v in a.ravel()]
json.dump(dict(source="lab/zero/belief_np.py", H=A.h, BX=BX, NN=NN, W1=r5(bestP["W1"]), b1=r5(bestP["b1"]), W2=r5(bestP["W2"]), b2=r5(bestP["b2"]),
               metrics=dict(heldLoss=round(float(best), 4), priorLoss=round(float(prior), 4), heldMAE=round(float(bmae), 3), priorMAE=round(float(pmae), 3), rows=int(R))), open(A.out, "w"))
open(A.out, "a").write("\n")
say(f"best held-out loss {best:.4f} a card against the pool's odds {prior:.4f}; {bmae:.3f} cards off a hand against {pmae:.3f}")
