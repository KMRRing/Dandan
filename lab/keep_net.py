"""
The keep net (13 Nov 2026, Fable): a first seven's chance to win, learned from real results instead of the value net's rating.
Input: the seven by card name (25 counts) and the seat (1 on the play). Target: the game's result. Data: lab/keep-data.mjs's
rows, the first sevens Medium kept (and the coin-kept ones of -explore self-play); every game with seed % 5 == 0 held out.
A small network (26 -> 32 -> 1, logistic), Adam, early stopping on the held-out loss.

How it decides (first keep only): keep when its rating is at or above the real redraw value (49.9% on the play, 49.0% on the
draw, first-sevens); a seven Medium throws back still goes back until exploration has data for it.
Yardstick (keep-share by hand type, held-out sevens): it passes when it throws back under 5% of 3 lands + 3+ good, under 15% of
3 lands + 2 good, and over 70% of each of the three weak types (2 lands + 2 good, 3 lands + 1 good, 4 lands + 1 good).
usage: python3 lab/keep_net.py <rows.tsv> <out.json> [--hidden 32] [--seed 1]
"""
import argparse, json, math, sys, time
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("rows"); ap.add_argument("out")
ap.add_argument("--hidden", type=int, default=32); ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--redraw-play", type=float, default=0.499); ap.add_argument("--redraw-draw", type=float, default=0.490)
A = ap.parse_args()
T0 = time.time()
rows = [l.rstrip("\n").split("\t") for l in open(A.rows) if l.strip()]
names = sorted({c for r in rows for c in r[7].split("|")})
ix = {c: i for i, c in enumerate(names)}
N = len(rows)
X = np.zeros((N, len(names) + 1), np.float32)
seed, play, kept, won, coin, lands, good = (np.array([float(r[k]) for r in rows]) for k in range(7))
for n, r in enumerate(rows):
    for c in r[7].split("|"): X[n, ix[c]] += 1
X[:, -1] = play
hold = (seed % 5 == 0)
use = (kept == 1) | (coin == 1)          # results only exist for hands that were played: kept ones (Medium's or a coin's)
tr, te = use & ~hold, use & hold
mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-6
Z = (X - mu) / sd
rng = np.random.default_rng(A.seed)
H = A.hidden
W1 = rng.normal(0, math.sqrt(2 / Z.shape[1]), (Z.shape[1], H)).astype(np.float64); b1 = np.zeros(H)
W2 = rng.normal(0, math.sqrt(1 / H), (H, 1)); b2 = np.zeros(1)
P = [W1, b1, W2, b2]; M = [np.zeros_like(p) for p in P]; V = [np.zeros_like(p) for p in P]
sig = lambda z: 1 / (1 + np.exp(-z))
def fwd(Zb):
    h = np.maximum(0, Zb @ W1 + b1)
    return h, sig(h @ W2 + b2)[:, 0]
def loss(idx):
    _, p = fwd(Z[idx]); y = won[idx]
    return float(-np.mean(y * np.log(p + 1e-9) + (1 - y) * np.log(1 - p + 1e-9)))
TR, TE = np.where(tr)[0], np.where(te)[0]
base = float(-np.mean(won[TE] * np.log(won[TR].mean()) + (1 - won[TE]) * np.log(1 - won[TR].mean())))
best, bestP, step, bad, lr = loss(TE), [p.copy() for p in P], 0, 0, 1e-3
for epoch in range(1, 61):
    order = rng.permutation(TR)
    for k in range(0, len(order), 256):
        b = order[k:k + 256]; h, p = fwd(Z[b]); g = (p - won[b])[:, None] / len(b)
        gW2 = h.T @ g; gb2 = g.sum(0); gh = (g @ W2.T) * (h > 0); gW1 = Z[b].T @ gh; gb1 = gh.sum(0)
        step += 1
        for j, (pp, gg) in enumerate(zip(P, [gW1, gb1, gW2, gb2])):
            M[j] = 0.9 * M[j] + 0.1 * gg; V[j] = 0.999 * V[j] + 0.001 * gg * gg
            pp -= lr * (M[j] / (1 - 0.9 ** step)) / (np.sqrt(V[j] / (1 - 0.999 ** step)) + 1e-8)
    l = loss(TE)
    if l < best - 1e-5: best, bestP, bad = l, [p.copy() for p in P], 0
    else:
        bad += 1
        if bad >= 5: break
for p, q in zip(P, bestP): p[...] = q
_, rate = fwd(Z)
redraw = np.where(play == 1, A.redraw_play, A.redraw_draw)
# the decision on every held-out first seven: Medium's throw-backs still go back; a kept one goes back when rated under the redraw
thrown = np.where(kept == 1, rate < redraw, True) | (coin == 1) & (kept == 0)
cell = lambda L, S: (lands == L) & ((good >= 3) if S == "3+" else (good == S))
report, ok = [], True
checks = [(3, "3+", "<", 0.05), (3, 2, "<", 0.15), (2, 2, ">", 0.70), (3, 1, ">", 0.70), (4, 1, ">", 0.70)]
for L, S, op, bar in checks:
    for side, sv in (("play", 1), ("draw", 0)):
        m = hold & cell(L, S) & (play == sv)
        share = float(thrown[m].mean()) if m.any() else float("nan")
        good_ = share < bar if op == "<" else share > bar
        ok &= bool(good_)
        report.append(f"{L} lands + {S} good, {side}: throws back {100 * share:.0f}% (bar {op} {100 * bar:.0f}%), {int(m.sum())} hands, rated {rate[m & (kept == 1)].mean():.3f} kept, won {won[m & (kept == 1)].mean():.3f} kept {'ok' if good_ else 'FAIL'}")
tot = {side: float(thrown[hold & (play == sv)].mean()) for side, sv in (("play", 1), ("draw", 0))}
out = dict(names=names, mu=mu.tolist(), sd=sd.tolist(), W1=W1.tolist(), b1=b1.tolist(), W2=W2[:, 0].tolist(), b2=float(b2[0]),
           redraw=dict(play=A.redraw_play, draw=A.redraw_draw), rows=N, trained=int(tr.sum()), held=int(te.sum()), heldLoss=round(best, 5),
           baseLoss=round(base, 5), thrownBack=tot, passes=ok, seconds=round(time.time() - T0))
json.dump(out, open(A.out, "w"))
print(json.dumps({k: v for k, v in out.items() if k not in ("mu", "sd", "W1", "b1", "W2", "names")}))
print("\n".join(report))
print(f"thrown back of all held-out first sevens: play {100 * tot['play']:.1f}%, draw {100 * tot['draw']:.1f}%; {'PASSES' if ok else 'does not pass'} the yardstick")
