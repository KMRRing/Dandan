"""Zero's value net on NumPy (14 Nov 2026, Fable No. 12): results only. The chance a seat wins is sigmoid(g(mine) - g(theirs)),
g an MLP with ReLU hidden layers and a linear last layer, mine and theirs the position's features seen from either seat
(dandan-eval.js makeJudge's form), cross-entropy on the result. Adam, batches of 256, the held-out rows (every fifth game) measured
after each epoch, the best epoch kept. Written in dandan-eval.js's layer format (8-bit weights, a scale per output, biases), so
makeJudge reads it.
usage: python3 lab/zero/value_np.py <packed folder> <out> [--shape 64x32] [--epochs 8] [--lr 1e-3] [--seed 1] [--wd 0]
"""
import argparse, base64, json, os, time
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("dir"); ap.add_argument("out")
ap.add_argument("--shape", default="64x32"); ap.add_argument("--epochs", type=int, default=8)
ap.add_argument("--lr", type=float, default=1e-3); ap.add_argument("--seed", type=int, default=1); ap.add_argument("--batch", type=int, default=256)
ap.add_argument("--wd", type=float, default=0.0)  # decoupled weight decay a step (14 Nov: the face-up net overfits from epoch 2)
A = ap.parse_args()
say = lambda m: print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)
meta = json.load(open(os.path.join(A.dir, "meta.json"))); N, R = meta["N"], meta["rows"]
rd = lambda n, t: np.fromfile(os.path.join(A.dir, n), dtype=t)
M, T, Y, H = rd("mine.f32", np.float32).reshape(R, N), rd("theirs.f32", np.float32).reshape(R, N), rd("won.f32", np.float32), rd("hold.u8", np.uint8) > 0
tr, he = np.flatnonzero(~H), np.flatnonzero(H)
sizes = [N] + [int(x) for x in A.shape.split("x")] + [1]
rng = np.random.default_rng(A.seed)
W = [rng.normal(0, np.sqrt(2 / a), (a, b)) for a, b in zip(sizes[:-1], sizes[1:])]; B = [np.zeros(b) for b in sizes[1:]]
mW = [np.zeros_like(w) for w in W]; vW = [np.zeros_like(w) for w in W]; mB = [np.zeros_like(b) for b in B]; vB = [np.zeros_like(b) for b in B]
say(f"{R} rows ({len(tr)} training, {len(he)} held out), {N} inputs, shape {A.shape}")

def g(x):
    hs = [x]
    for l in range(len(W)):
        z = hs[-1] @ W[l] + B[l]
        hs.append(np.maximum(z, 0) if l < len(W) - 1 else z)
    return hs

def loss_of(idx):
    out = 0.0
    for s in range(0, len(idx), 65536):
        j = idx[s:s + 65536]
        d = g(M[j])[-1][:, 0] - g(T[j])[-1][:, 0]
        p = 1 / (1 + np.exp(-np.clip(d, -30, 30)))
        out += -(Y[j] * np.log(p + 1e-9) + (1 - Y[j]) * np.log(1 - p + 1e-9)).sum()
    return out / max(1, len(idx))

def back(hs, gout):
    gW, gB, gz = [None] * len(W), [None] * len(W), gout
    for l in range(len(W) - 1, -1, -1):
        gW[l] = hs[l].T @ gz; gB[l] = gz.sum(0)
        if l: gz = (gz @ W[l].T) * (hs[l] > 0)
    return gW, gB

best, bestW, t = loss_of(he), ([w.copy() for w in W], [b.copy() for b in B]), 0
say(f"before training: held-out loss {best:.4f}")
for e in range(1, A.epochs + 1):
    order = rng.permutation(tr)
    for s in range(0, len(order), A.batch):
        j = order[s:s + A.batch]; t += 1
        hm, ht = g(M[j]), g(T[j])
        d = hm[-1][:, 0] - ht[-1][:, 0]
        p = 1 / (1 + np.exp(-np.clip(d, -30, 30)))
        gd = ((p - Y[j]) / len(j))[:, None]
        aW, aB = back(hm, gd); bW, bB = back(ht, -gd)
        for l in range(len(W)):
            for P_, G_, m_, v_ in ((W, aW[l] + bW[l], mW, vW), (B, aB[l] + bB[l], mB, vB)):
                m_[l] = 0.9 * m_[l] + 0.1 * G_; v_[l] = 0.999 * v_[l] + 0.001 * G_ ** 2
                P_[l] -= A.lr * (m_[l] / (1 - 0.9 ** t)) / (np.sqrt(v_[l] / (1 - 0.999 ** t)) + 1e-8)
            if A.wd: W[l] *= 1 - A.lr * A.wd
    h = loss_of(he)
    say(f"epoch {e}: held-out loss {h:.4f}")
    if h < best: best, bestW = h, ([w.copy() for w in W], [b.copy() for b in B])

Wb, Bb = bestW
layers = []
for l, (w, b) in enumerate(zip(Wb, Bb)):
    sc = np.maximum(np.abs(w).max(0), 1e-8) / 127
    q = np.clip(np.round(w / sc), -127, 127).astype(np.int8)
    layers.append(dict(n=[int(w.shape[0]), int(w.shape[1])], q=base64.b64encode(q.tobytes()).decode(), s=[float(round(x, 8)) for x in sc], b=[float(round(x, 6)) for x in b] if l < len(Wb) - 1 else []))
json.dump(dict(source="lab/zero/value_np.py", note=f"Zero value net, {A.shape}, {R} rows", metrics=dict(heldLoss=round(float(best), 4), rows=int(R)), layers=layers), open(A.out, "w"))
open(A.out, "a").write("\n")
say(f"best held-out loss {best:.4f} (a coin: 0.6931)")
