"""lab/judge-variants.mjs's training, on NumPy (13 Nov 2026, Fable: the arithmetic on a tensor library, CPU only).

Reads the position cache judge-variants.mjs writes (cache/rows/<batch>/m<inputs>-p<positions a game>-v1: a JSON header line,
then gzipped base64 Float32 rows of 3*M + 6 numbers: the inputs, both one-card-gone inputs (NaN when the hand was empty), the
search's value, the result, the library, slow, decked, the game within the batch), fetched beforehand into one folder by
lab/fetch-rows.mjs. It trains the same network the same way: an MLP with ReLU hidden layers, the chance a sigmoid of
g(mine) - g(theirs) (the inputs swapped seat for seat), cross-entropy on the label (the result, or blended with the search's
value), the floor rule (a card taken from a hand may not raise its holder's chance... as judge-variants' pGrad pairs), Adam,
batches of 64, the held-out loss four times an epoch, the best point kept, early stopping after a whole epoch with no new best.
Every fifth game is held out, counted from the first read, as there. The judge is written in the same JSON format (8-bit
weights, a scale per output, biases; none on the last layer), so the engine reads it unchanged.

usage: python3 lab/train_np.py <rows folder> <batches, comma-separated, in order> <variant> <out> [--lr 3e-4] [--seed 1]
       [--cap games] [--epochs n] [--consts '{"N":100,"PLUS":8,"RACE":8}']
"""
import argparse, base64, gzip, json, math, os, sys, time

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("rows"); ap.add_argument("batches"); ap.add_argument("variant", type=int); ap.add_argument("out")
ap.add_argument("--lr", type=float, default=0); ap.add_argument("--seed", type=int, default=1); ap.add_argument("--cap", type=int, default=0)
ap.add_argument("--epochs", type=int, default=0); ap.add_argument("--consts", default='{"N":100,"PLUS":8,"RACE":8}')
A = ap.parse_args()
T0 = time.time()
say = lambda m: print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

# ---------- the variants, as judge-variants.mjs numbers them ----------
VARIANTS = []
for plus in (False, True):
    for shape in ("32x16 warm", "64x32", "128x64x32"):
        for blend in (0, 0.5):
            for floor in (0, 1):
                VARIANTS.append(dict(plus=plus, race=False, shape=shape, blend=blend, floor=floor))
VARIANTS.append(dict(plus=True, race=True, shape="128x64x32", blend=0.5, floor=1))
V = VARIANTS[A.variant]
if V["shape"].endswith("warm"):
    sys.exit("warm-started variants are not ported (they start from today's weights); use judge-variants.mjs")
C = json.loads(A.consts); N, PLUS, RACE = C["N"], C["PLUS"], C["RACE"]
HALF = (N - 3 - 17) // 2
M = N + 2 * PLUS + 2 * RACE if V["race"] else N + 2 * PLUS if V["plus"] else N
W = 3 * M + 6

# the seat-for-seat swap: a permutation of the inputs, and whose turn it is flipped
perm = np.arange(M)
perm[0:HALF] = np.arange(HALF, 2 * HALF); perm[HALF:2 * HALF] = np.arange(0, HALF)
if M > N:
    perm[N:N + PLUS] = np.arange(N + PLUS, N + 2 * PLUS); perm[N + PLUS:N + 2 * PLUS] = np.arange(N, N + PLUS)
if V["race"]:
    r = N + 2 * PLUS
    perm[r:r + RACE] = np.arange(r + RACE, r + 2 * RACE); perm[r + RACE:r + 2 * RACE] = np.arange(r, r + RACE)
def swap(X):
    S = X[:, perm].copy(); S[:, 2 * HALF] = 1 - X[:, 2 * HALF]; return S

# ---------- the rows ----------
parts, games, cap = [], 0, A.cap or math.inf
for batch in A.batches.split(","):
    if games >= cap: break
    f = os.path.join(A.rows, batch.replace("/", "~"))   # a slice job/0-199 is saved as job~0-199
    if not os.path.exists(f): say(f"{batch}: no cached rows, skipped"); continue
    text = open(f, "rb").read()
    nl = text.index(b"\n"); head = json.loads(text[:nl])
    R = np.frombuffer(gzip.decompress(base64.b64decode(text[nl + 1:])), dtype=np.float32).reshape(-1, W)
    if head.get("rows") != len(R): sys.exit(f"{batch}: {len(R)} rows, header says {head.get('rows')}")
    g = R[:, -1].astype(np.int64)
    take = min(head["games"], cap - games)          # every fifth game held out, counted from the first read
    keep = g < take
    gi = games + g[keep]
    parts.append((R[keep], gi % 5 == 0, gi + 1))
    games += take
R = np.concatenate([p[0] for p in parts]); hold = np.concatenate([p[1] for p in parts]); game = np.concatenate([p[2] for p in parts])
del parts
a, w0, w1 = R[:, :M], R[:, M:2 * M], R[:, 2 * M:3 * M]
search, won, lib, slow, decked = R[:, 3 * M], R[:, 3 * M + 1], R[:, 3 * M + 2], R[:, 3 * M + 3] > 0, R[:, 3 * M + 4] > 0
has0, has1 = ~np.isnan(w0[:, 0]), ~np.isnan(w1[:, 0])
y = V["blend"] * search + (1 - V["blend"]) * won
tr, te = np.where(~hold)[0], np.where(hold)[0]
say(f"{games} games, {len(R)} positions ({len(tr)} to train, {len(te)} held out), {M} inputs, {R.nbytes >> 20} MB")

# ---------- the network ----------
rng = np.random.default_rng(A.seed)
sizes = [M] + [int(x) for x in V["shape"].split("x")] + [1]
NET = [[(rng.standard_normal((sizes[l], sizes[l + 1])) * math.sqrt(2 / sizes[l])), np.zeros(sizes[l + 1])] for l in range(len(sizes) - 1)]
def forward(net, X):
    acts, h = [X], X
    for l, (Wt, b) in enumerate(net):
        h = h @ Wt + b
        if l < len(net) - 1: h = np.maximum(h, 0)
        acts.append(h)
    return acts
def g(net, X): return forward(net, X)[-1][:, 0]
def chance(net, X, S=None): return 1 / (1 + np.exp(np.clip(g(net, S if S is not None else swap(X)) - g(net, X), -50, 50)))
def backward(net, acts, d):
    grads, d = [None] * len(net), d[:, None]
    for l in range(len(net) - 1, -1, -1):
        Wt, _ = net[l]; x = acts[l]
        grads[l] = [x.T @ d, d.sum(0)]
        if l: d = (d @ Wt.T) * (acts[l] > 0)
    return grads

# the held-out loss (the result, 1e-6 clipped) and the screen, as judge-variants.mjs's check and screen
aT, sT = a[te].astype(np.float64), swap(a[te]).astype(np.float64)
def held_loss(net):
    p = np.clip(chance(net, aT, sT), 1e-6, 1 - 1e-6); yw = won[te]
    return float(-np.mean(yw * np.log(p) + (1 - yw) * np.log(1 - p)))
def screen(net):
    p = chance(net, aT, sT); r = lambda m: round(float(np.mean((p[m] - won[te][m]) ** 2)), 4) if m.any() else None
    bad = n = 0
    for side, (wx, hx) in enumerate(((w0, has0), (w1, has1))):
        idx = te[hx[te]]
        if not len(idx): continue
        d = chance(net, wx[idx].astype(np.float64)) - p[hx[te]]
        n += len(idx); bad += int(np.sum(d > 0.01) if side == 0 else np.sum(d < -0.01))
    first = {}
    for k in np.where(decked[te] & (lib[te] <= 12) & (won[te] != 0.5))[0]:
        first.setdefault(int(game[te][k]), k)
    calls = list(first.values()); right = sum(1 for k in calls if (p[k] > 0.5) == (won[te][k] == 1))
    return dict(all=r(np.ones(len(te), bool)), slow=r(slow[te]), late=r(lib[te] <= 20), flaws=round(bad / n, 4) if n else None,
                decked12=round(right / len(calls), 4) if calls else None, decked12n=len(calls))

# ---------- training ----------
lr = A.lr or 1e-3
epochs = A.epochs or 10
m1 = [[np.zeros_like(Wt), np.zeros_like(b)] for Wt, b in NET]; m2 = [[np.zeros_like(Wt), np.zeros_like(b)] for Wt, b in NET]
t, best, since, stopped, PATIENCE = 0, dict(loss=math.inf, net=None, epoch=0), 0, None, 4
def check(at):
    global best, since, stopped
    h = held_loss(NET)
    say(f"epoch {at:.2f}/{epochs}: held-out loss {h:.4f}")
    if h < best["loss"]: best = dict(loss=h, epoch=round(at, 2), net=[[Wt.copy(), b.copy()] for Wt, b in NET]); since = 0
    else:
        since += 1
        if since >= PATIENCE and at >= 1: stopped = round(at, 2); say(f"stopped early at epoch {stopped}: no better held-out loss since {best['epoch']}")
floor = V["floor"]
for e in range(1, epochs + 1):
    if stopped: break
    order = tr[rng.permutation(len(tr))]
    quarter = max(64, math.ceil(len(order) / 4 / 64) * 64)
    for k in range(0, len(order), 64):
        if k and k % quarter == 0:
            check(e - 1 + k / len(order))
            if stopped: break
        ix = order[k:k + 64]; B = len(ix)
        xa = a[ix].astype(np.float64)
        blocks = [xa, swap(xa)]
        if floor:
            m0, m1_ = has0[ix], has1[ix]
            x0, x1 = w0[ix][m0].astype(np.float64), w1[ix][m1_].astype(np.float64)
            blocks += [x0, swap(x0), x1, swap(x1)]
        X = np.concatenate(blocks); acts = forward(NET, X); out = acts[-1][:, 0]
        ga, gs = out[:B], out[B:2 * B]
        p = 1 / (1 + np.exp(np.clip(gs - ga, -50, 50)))
        d = np.zeros(len(X))
        ce = (p - y[ix]) / B                       # cross-entropy on the label: d/dg(mine) = p - y
        d[:B] += ce; d[B:2 * B] -= ce
        if floor:
            o, pp = 2 * B, p * (1 - p) / B
            for side, (mask, n_) in enumerate(((m0, len(x0)), (m1_, len(x1)))):
                if not n_: continue
                gx, gxs = out[o:o + n_], out[o + n_:o + 2 * n_]
                q = 1 / (1 + np.exp(np.clip(gxs - gx, -50, 50)))
                gap = (q - p[mask]) if side == 0 else (p[mask] - q)
                on = gap > 0; sign = 1 if side == 0 else -1
                qq = q * (1 - q) / B * on * sign
                d[o:o + n_] += qq; d[o + n_:o + 2 * n_] -= qq
                rows = np.where(mask)[0][on]
                d[rows] -= sign * pp[rows]; d[B + rows] += sign * pp[rows]
                o += 2 * n_
        G = backward(NET, acts, d)
        t += 1
        for l in range(len(NET)):
            for j in (0, 1):
                gi = G[l][j]
                m1[l][j] = 0.9 * m1[l][j] + 0.1 * gi; m2[l][j] = 0.999 * m2[l][j] + 0.001 * gi * gi
                NET[l][j] -= lr * (m1[l][j] / (1 - 0.9 ** t)) / (np.sqrt(m2[l][j] / (1 - 0.999 ** t)) + 1e-8)
    if not stopped: check(e)

# ---------- the judge, 8-bit as dandan-eval.js reads it ----------
def quant(Wt, b, last):
    s = np.abs(Wt).max(0) / 127
    q = np.where(s > 0, np.floor(Wt / np.where(s > 0, s, 1) + 0.5), 0).astype(np.int64)
    return dict(n=[int(Wt.shape[0]), int(Wt.shape[1])], q=base64.b64encode(((q + 256) % 256).astype(np.uint8).tobytes()).decode(),
                s=[float(f"{x:.6g}") for x in s], b=[] if last else [float(f"{x:.6g}") for x in b])
def dequant(L):
    nIn, nOut = L["n"]; q = np.frombuffer(base64.b64decode(L["q"]), np.uint8).astype(np.int64); q = np.where(q > 127, q - 256, q)
    return [(q.reshape(nIn, nOut) * np.array(L["s"])), np.array(L["b"]) if L["b"] else np.zeros(nOut)]
layers = [quant(Wt, b, l == len(best["net"]) - 1) for l, (Wt, b) in enumerate(best["net"])]
rounded = [dequant(L) for L in layers]
line = dict(variant=A.variant, trainer="numpy", seed=A.seed, spec=V, lr=lr, games=games, positions=int(len(R)), epoch=best["epoch"], stopped=stopped,
            heldLoss=round(best["loss"], 5), heldLossRounded=round(held_loss(rounded), 5), metrics=screen(rounded), seconds=round(time.time() - T0), layers=layers)
print(json.dumps({k: v for k, v in line.items() if k != "layers"}), flush=True)
open(A.out, "w").write(json.dumps(line) + "\n")
