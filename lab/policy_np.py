"""The Medium-free move-picker trained on NumPy (14 Nov 2026, Fable No. 9 points 4-5), beside lab/train_np.py.

Reads the files lab/fetch-ex.mjs packs (export decisions where the search weighed every legal move) and trains one of two forms
to pick the search's move among passing and every legal move (target "pick": cross-entropy on the softmax of the scores):

  mlp   lab/policy-train.mjs's Medium-free model: the position's part of the first layer once (x · wx + b1), each move's marks'
        rows of wm added, ReLU, a second layer (H2, ReLU) and w3. Its cost grows with the moves: the second layer runs once each.
  head  a policy head: a trunk reads the position once (XN -> H1 -> H2, ReLU both), each mark has a learned vector of H2 numbers
        (E) and a bias (eb); a move scores trunk · (sum of its marks' vectors) + the sum of its marks' biases.

Adam (lr 1e-3), batches of 64, each decision at weight 1 (the JavaScript trainer's light 1), 6 epochs; the held-out decisions
(the export's every fifth game, never trained on) measured after each epoch and the epoch with the lowest held-out loss kept.
Metrics as policy-train.mjs's (agreement with the search beside Medium's, value given up in points, off-shortlist picks), and
Fable No. 8 point 1's: agreement by the kind of the search's move, and passing where the search acted / acting where it passed.
The model is written as one JSON line that dandan-netpolicy.js makePlus plays (medium: false; form "head" for the head).

usage: python3 lab/policy_np.py <packed folder> <out> [--form mlp|head] [--h1 128] [--h2 64] [--epochs 6] [--lr 1e-3]
       [--batch 64] [--seed 1]
"""
import argparse, json, os, time

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("dir"); ap.add_argument("out")
ap.add_argument("--form", default="mlp", choices=["mlp", "head"])
ap.add_argument("--h1", type=int, default=128); ap.add_argument("--h2", type=int, default=64)
ap.add_argument("--epochs", type=int, default=6); ap.add_argument("--lr", type=float, default=1e-3)
ap.add_argument("--batch", type=int, default=64); ap.add_argument("--seed", type=int, default=1)
A = ap.parse_args()
say = lambda m: print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)
MOVE_N = 80
KINDS = ["pass", "land", "cast", "cycle", "ability"]

# ---------- the packed decisions ----------
meta = json.load(open(os.path.join(A.dir, "meta.json")))
XN, D = meta["XN"], meta["decisions"]
rd = lambda n, t: np.fromfile(os.path.join(A.dir, n), dtype=t)
X = rd("x.f32", np.float32).reshape(D, XN)
cand = rd("cand.i32", np.int32).astype(np.int64)
pick, med, flags = rd("pick.i16", np.int16).astype(np.int64), rd("med.i16", np.int16).astype(np.int64), rd("flags.u8", np.uint8)
Q, mark, MARKS = rd("q.f32", np.float32), rd("mark.i32", np.int32).astype(np.int64), rd("marks.u8", np.uint8).astype(np.int64)
ncand = np.diff(cand)
kind = MARKS[mark[:-1]]                                   # a candidate's first mark is its kind
held_mask = (flags & 1) > 0
train_idx, held_idx = np.flatnonzero(~held_mask), np.flatnonzero(held_mask)
say(f"{D} decisions ({len(train_idx)} training, {len(held_idx)} held out), {len(Q)} candidates, {len(MARKS)} marks, {XN} inputs; "
    f"{meta['exports']}; form {A.form} {A.h1}x{A.h2}")


def gather(idx):
    """The candidates and marks of decisions idx: what a batch's forward pass needs."""
    st, cn = cand[idx], ncand[idx]
    nc = int(cn.sum())
    cstart = np.concatenate(([0], np.cumsum(cn)[:-1]))
    cid = np.repeat(st - cstart, cn) + np.arange(nc)
    dec = np.repeat(np.arange(len(idx)), cn)
    ms, mc = mark[cid], mark[cid + 1] - mark[cid]
    mstart = np.concatenate(([0], np.cumsum(mc)[:-1]))
    mid = np.repeat(ms - mstart, mc) + np.arange(int(mc.sum()))
    return dict(idx=idx, cid=cid, dec=dec, cstart=cstart, rows=MARKS[mid], mcand=np.repeat(np.arange(nc), mc), mstart=mstart,
                target=cstart + pick[idx], medc=cstart + med[idx])


# ---------- the model ----------
rng = np.random.default_rng(A.seed)
U = lambda shape, a: rng.uniform(-a, a, size=shape)
H1, H2 = A.h1, A.h2
if A.form == "mlp":   # policy-train.mjs's start: w3 at zero
    P = dict(wx=U((XN, H1), np.sqrt(1 / XN)), wm=U((MOVE_N, H1), np.sqrt(1 / 8)), b1=np.zeros(H1),
             w2=U((H1, H2), np.sqrt(2 / H1)), b2=np.zeros(H2), w3=np.zeros(H2))
else:
    P = dict(W1=U((XN, H1), np.sqrt(6 / XN)), c1=np.zeros(H1), W2=U((H1, H2), np.sqrt(6 / H1)), c2=np.zeros(H2),
             E=U((MOVE_N, H2), 0.05), eb=np.zeros(MOVE_N))
M = {k: np.zeros_like(v) for k, v in P.items()}
V = {k: np.zeros_like(v) for k, v in P.items()}


def forward(g):
    x = X[g["idx"]]
    if A.form == "mlp":
        base = x @ P["wx"] + P["b1"]
        pre1 = base[g["dec"]] + np.add.reduceat(P["wm"][g["rows"]], g["mstart"], axis=0)
        h1 = np.maximum(pre1, 0)
        pre2 = h1 @ P["w2"] + P["b2"]
        h2 = np.maximum(pre2, 0)
        f = h2 @ P["w3"]
        return f, dict(x=x, pre1=pre1, h1=h1, pre2=pre2, h2=h2)
    a1 = np.maximum(x @ P["W1"] + P["c1"], 0)
    z = np.maximum(a1 @ P["W2"] + P["c2"], 0)
    ev = np.add.reduceat(P["E"][g["rows"]], g["mstart"], axis=0)
    f = (z[g["dec"]] * ev).sum(1) + np.add.reduceat(P["eb"][g["rows"]], g["mstart"])
    return f, dict(x=x, a1=a1, z=z, ev=ev)


def softmax(f, g):
    mx = np.maximum.reduceat(f, g["cstart"])
    e = np.exp(f - mx[g["dec"]])
    return e / np.add.reduceat(e, g["cstart"])[g["dec"]]


def step(g, t):
    f, c = forward(g)
    p = softmax(f, g)
    n = len(g["idx"])
    loss = -np.log(p[g["target"]] + 1e-12).sum()
    df = p.copy(); df[g["target"]] -= 1; df /= n
    G = {}
    if A.form == "mlp":
        G["w3"] = c["h2"].T @ df
        d2 = np.outer(df, P["w3"]) * (c["pre2"] > 0)
        G["w2"] = c["h1"].T @ d2; G["b2"] = d2.sum(0)
        d1 = (d2 @ P["w2"].T) * (c["pre1"] > 0)
        G["wm"] = np.zeros_like(P["wm"]); np.add.at(G["wm"], g["rows"], d1[g["mcand"]])
        db = np.add.reduceat(d1, g["cstart"], axis=0)
        G["wx"] = c["x"].T @ db; G["b1"] = db.sum(0)
    else:
        dz = np.add.reduceat(df[:, None] * c["ev"], g["cstart"], axis=0) * (c["z"] > 0)
        dev = df[:, None] * c["z"][g["dec"]]
        G["E"] = np.zeros_like(P["E"]); np.add.at(G["E"], g["rows"], dev[g["mcand"]])
        G["eb"] = np.bincount(g["rows"], weights=df[g["mcand"]], minlength=MOVE_N)
        G["W2"] = c["a1"].T @ dz; G["c2"] = dz.sum(0)
        da = (dz @ P["W2"].T) * (c["a1"] > 0)
        G["W1"] = c["x"].T @ da; G["c1"] = da.sum(0)
    b1, b2 = 0.9, 0.999
    for k in P:
        M[k] = b1 * M[k] + (1 - b1) * G[k]; V[k] = b2 * V[k] + (1 - b2) * G[k] ** 2
        P[k] -= A.lr * (M[k] / (1 - b1 ** t)) / (np.sqrt(V[k] / (1 - b2 ** t)) + 1e-8)
    return loss


def measure(idx):
    """policy-train.mjs's metrics on decisions idx, with agreement by the kind of the search's move and pass/act errors."""
    loss = med_up = mod_up = agree_med = agree_mod = 0.0
    off_n = off_first = 0
    by = {k: [0, 0, 0] for k in KINDS}       # decisions, Medium agrees, the model agrees
    acted = passed = pass_err = act_err = med_pass_err = med_act_err = 0
    for s in range(0, len(idx), 8192):
        g = gather(idx[s:s + 8192])
        f, _ = forward(g)
        p = softmax(f, g)
        loss -= np.log(p[g["target"]] + 1e-12).sum()
        best = np.maximum.reduceat(f, g["cstart"])
        # the first candidate with the top score (ties as the engine breaks them: the first listed)
        is_top = f == best[g["dec"]]
        first_top = np.full(len(g["idx"]), -1); first_top[g["dec"][is_top][::-1]] = np.flatnonzero(is_top)[::-1]
        q = Q[g["cid"]]
        qmax = np.maximum.reduceat(q, g["cstart"])
        med_up += (qmax - q[g["medc"]]).sum(); mod_up += (qmax - q[first_top]).sum()
        ag_med, ag_mod = g["medc"] == g["target"], first_top == g["target"]
        agree_med += ag_med.sum(); agree_mod += ag_mod.sum()
        off = (flags[g["idx"]] & 8) > 0
        off_n += off.sum(); off_first += (ag_mod & off).sum()
        kt = kind[g["cid"][g["target"]]]
        for i, k in enumerate(KINDS):
            m = kt == i
            by[k][0] += int(m.sum()); by[k][1] += int((ag_med & m).sum()); by[k][2] += int((ag_mod & m).sum())
        k_mod, k_med = kind[g["cid"][first_top]], kind[g["cid"][g["medc"]]]
        a, ps = kt != 0, kt == 0
        acted += a.sum(); passed += ps.sum()
        pass_err += (a & (k_mod == 0)).sum(); act_err += (ps & (k_mod != 0)).sum()
        med_pass_err += (a & (k_med == 0)).sum(); med_act_err += (ps & (k_med != 0)).sum()
    n = len(idx)
    r4 = lambda v: round(float(v), 4)
    return dict(decisions=n, loss=r4(loss / n), mediumGivesUp=round(float(100 * med_up / n), 3), modelGivesUp=round(float(100 * mod_up / n), 3),
                mediumAgrees=r4(agree_med / n), modelAgrees=r4(agree_mod / n), offPicks=int(off_n), offFirst=r4(off_first / max(1, off_n)),
                byKind={k: dict(decisions=v[0], mediumAgrees=r4(v[1] / max(1, v[0])), modelAgrees=r4(v[2] / max(1, v[0]))) for k, v in by.items()},
                passWhereActed=dict(model=r4(pass_err / max(1, acted)), medium=r4(med_pass_err / max(1, acted)), of=int(acted)),
                actWherePassed=dict(model=r4(act_err / max(1, passed)), medium=r4(med_act_err / max(1, passed)), of=int(passed)))


best = dict(measure(held_idx), epoch=0); bestP = {k: v.copy() for k, v in P.items()}
say(f"before training: {json.dumps(best)}")
t = 0
for e in range(1, A.epochs + 1):
    order = rng.permutation(train_idx)
    tl = 0.0
    for s in range(0, len(order), A.batch):
        t += 1
        tl += step(gather(order[s:s + A.batch]), t)
    h = measure(held_idx)
    say(f"epoch {e}: training loss {tl / len(order):.4f}, held out {json.dumps(h)}")
    if h["loss"] < best["loss"]:
        best = dict(h, epoch=e); bestP = {k: v.copy() for k, v in P.items()}

r5 = lambda a: [round(float(v), 5) for v in np.asarray(a, dtype=np.float64).ravel()]
if A.form == "mlp":   # dandan-netpolicy.js's layout: wx[i·H1 + o], wm[mark·H1 + o], w2[o·H2 + o2]; no Medium-score weights
    net = dict(XN=XN, H1=H1, H2=H2, wx=r5(bestP["wx"]), wm=r5(bestP["wm"]), ws=[0] * H1, b1=r5(bestP["b1"]), w2=r5(bestP["w2"]),
               b2=r5(bestP["b2"]), w3=r5(bestP["w3"]))
else:
    net = dict(XN=XN, H1=H1, H2=H2, W1=r5(bestP["W1"]), c1=r5(bestP["c1"]), W2=r5(bestP["W2"]), c2=r5(bestP["c2"]), E=r5(bestP["E"]),
               eb=r5(bestP["eb"]))
g0 = 1 - best["modelGivesUp"] / best["mediumGivesUp"] if best["mediumGivesUp"] > 0 else 0
metrics = dict(best, every=dict(best), games=None, train=int(len(train_idx)), held=int(len(held_idx)), g0Reduction=round(g0, 4), g0Pass=g0 >= 0.25,
               trainer="policy_np.py", form=A.form)
out = dict(alpha=0, beta=0, medium=False, **({"form": "head"} if A.form == "head" else {}), net=net, metrics=metrics)
open(A.out, "w").write(json.dumps(out) + "\n")
say(f"best epoch {best['epoch']}: {json.dumps(best)}")
