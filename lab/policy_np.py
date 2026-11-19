"""The Medium-free move-picker trained on NumPy (14 Nov 2026, Fable No. 9 points 4-5), beside lab/train_np.py.

Reads the files lab/fetch-ex.mjs packs (export decisions where the search weighed every legal move) and trains one of two forms
to pick the search's move among passing and every legal move (target "pick": cross-entropy on the softmax of the scores):

  mlp   lab/policy-train.mjs's Medium-free model: the position's part of the first layer once (x · wx + b1), each move's marks'
        rows of wm added, ReLU, a second layer (H2, ReLU) and w3. Its cost grows with the moves: the second layer runs once each.
  head  a policy head: a trunk reads the position once (XN -> H1 -> H2, ReLU both), each mark has a learned vector of H2 numbers
        (E) and a bias (eb); a move scores trunk · (sum of its marks' vectors) + the sum of its marks' biases.
  head2 (17 Nov 2026, Fable: a hidden layer on the move scorer, stage 3): the same trunk; the position's part of a hidden layer
        once (trunk · W3 + c3, H3), each move's marks' rows of E3 added, ReLU, then w4, plus the marks' biases. A move's score is
        no longer linear in its marks: two marks can matter only together (this card, at that target).

Adam (lr 1e-3), batches of 64, a Deep decision at weight 1 and any other at --light (1 by default, the JavaScript trainer's
light 1; No. 7 point 7's Deep retrains 0.3), 6 epochs; the held-out decisions
(the export's every fifth game, never trained on) measured after each epoch and the epoch with the lowest held-out loss kept.
Metrics as policy-train.mjs's (agreement with the search beside Medium's, value given up in points, off-shortlist picks), and
Fable No. 8 point 1's: agreement by the kind of the search's move, and passing where the search acted / acting where it passed.
The model is written as one JSON line that dandan-netpolicy.js makePlus plays (medium: false; form "head" for the head).

usage: python3 lab/policy_np.py <packed folder> <out> [--form mlp|head] [--h1 128] [--h2 64] [--epochs 6] [--lr 1e-3]
       [--batch 64] [--seed 1] [--light 1] [--decay 1]
"""
import argparse, json, os, sys, time

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("dir"); ap.add_argument("out")
ap.add_argument("--form", default="mlp", choices=["mlp", "head", "head2"])
ap.add_argument("--h3", type=int, default=64)
ap.add_argument("--h1", type=int, default=128); ap.add_argument("--h2", type=int, default=64)
ap.add_argument("--epochs", type=int, default=6); ap.add_argument("--lr", type=float, default=1e-3)
ap.add_argument("--batch", type=int, default=64); ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--decay", type=float, default=1.0)  # the learning rate times this after each epoch (14 Nov: longer trainings)
ap.add_argument("--light", type=float, default=1.0)  # the weight of a decision that is not Deep (No. 7 point 7: 0.3); Deep ones 1
# soft targets (15 Nov 2026, Korbi 10:45, as AlphaZero): learn the search's whole spread, softmax(q / soft) over the candidates'
# searched values, not only its top move; 0 = the top move alone
ap.add_argument("--soft", type=float, default=0.0)
# warm start (15 Nov 2026, Korbi: "very significant"): begin from a trained net of the same form and sizes instead of from random,
# as AlphaGo Zero and AlphaZero never reset theirs; the held-out loss before training is the bar, so it never comes out worse there
ap.add_argument("--init", default="")
# training-only outputs (18 Nov 2026, Korbi 14:57–15:08; head2 only, dropped from the file written): the game's result for the
# deciding seat from the trunk, and the other seat's response to the move while it is on the stack (let it resolve / aim a spell
# at it / another play) from the played move's own hidden layer; their weights in the loss
ap.add_argument("--aux_res", "--aux-res", dest="aux_res", type=float, default=0.0)
ap.add_argument("--aux_resp", "--aux-resp", dest="aux_resp", type=float, default=0.0)
# the removal test (18 Nov 2026): inputs from this column on read as zero in training, so their weights stay at zero in the file
ap.add_argument("--zero_from", "--zero-from", dest="zero_from", type=int, default=0)
# the refinement stage (19 Nov 2026, Korbi: deep games refine what the quick games set): train and measure on the decisions the
# packer flagged 32 (REFINE batches) alone; with --init the net from the main stage
ap.add_argument("--refine_only", "--refine-only", dest="refine_only", action="store_true")
A = ap.parse_args()
say = lambda m: print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)
MOVE_N = 80   # a move's marks; a pack can say otherwise (markN: Zero 2's moves and answers in one encoding, 256)
KINDS = ["pass", "land", "cast", "cycle", "ability"]

# ---------- the packed decisions ----------
meta = json.load(open(os.path.join(A.dir, "meta.json")))
XN, D = meta["XN"], meta["decisions"]
MOVE_N = meta.get("markN", MOVE_N)
rd = lambda n, t: np.fromfile(os.path.join(A.dir, n), dtype=t)
# the general encoding (17 Nov 2026) stores x as 16-bit floats, read in place (a memory map) and widened a batch at a time
X16 = os.path.exists(os.path.join(A.dir, "x.f16"))
X = np.memmap(os.path.join(A.dir, "x.f16"), dtype=np.float16, mode="r", shape=(D, XN)) if X16 else rd("x.f32", np.float32).reshape(D, XN)
cand = rd("cand.i32", np.int32).astype(np.int64)
pick, med, flags = rd("pick.i16", np.int16).astype(np.int64), rd("med.i16", np.int16).astype(np.int64), rd("flags.u8", np.uint8)
Q, mark, MARKS = rd("q.f32", np.float32), rd("mark.i32", np.int32).astype(np.int64), rd("marks.u8", np.uint8).astype(np.int64)
ncand = np.diff(cand)
has = lambda n: os.path.exists(os.path.join(A.dir, n))
RES = rd("res.f32", np.float32) if has("res.f32") else None
RESP = rd("resp.i8", np.int8).astype(np.int64) if has("resp.i8") else None
AUX_RES = A.aux_res if RES is not None and A.form == "head2" else 0.0
AUX_RESP = A.aux_resp if RESP is not None and A.form == "head2" else 0.0
# rc.f32 (18 Nov 2026, Korbi: the opponent's response to every candidate): three a candidate, the search's replies over its deals
# as shares (−1: none); when the pack has it, the response output learns from every candidate with replies, not the move played only
RC = rd("rc.f32", np.float32).reshape(-1, 3) if has("rc.f32") else None
if RC is not None and not (RC[:, 0] >= 0).any(): RC = None   # games from before the search kept its replies: the move played only
AUX_RC = A.aux_resp if RC is not None and A.form == "head2" else 0.0
if AUX_RC: AUX_RESP = 0.0
kind = MARKS[mark[:-1]]                                   # a candidate's first mark is its kind
held_mask = (flags & 1) > 0
WEIGHT = np.where((flags & 2) > 0, 1.0, A.light)
train_idx, held_idx = np.flatnonzero(~held_mask), np.flatnonzero(held_mask)
if A.refine_only:
    rf = (flags & 32) > 0
    train_idx, held_idx = train_idx[rf[train_idx]], held_idx[rf[held_idx]]
    if not len(train_idx): sys.exit("--refine_only: no decision in the pack is flagged for refinement (REFINE)")
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
elif A.form == "head":
    P = dict(W1=U((XN, H1), np.sqrt(6 / XN)), c1=np.zeros(H1), W2=U((H1, H2), np.sqrt(6 / H1)), c2=np.zeros(H2),
             E=U((MOVE_N, H2), 0.05), eb=np.zeros(MOVE_N))
else:
    H3 = A.h3
    P = dict(W1=U((XN, H1), np.sqrt(6 / XN)), c1=np.zeros(H1), W2=U((H1, H2), np.sqrt(6 / H1)), c2=np.zeros(H2),
             W3=U((H2, H3), np.sqrt(6 / H2)), c3=np.zeros(H3), E3=U((MOVE_N, H3), 0.1), w4=np.zeros(H3), eb=np.zeros(MOVE_N))
if A.init:
    net0 = json.load(open(A.init))["net"]
    # a view grown at its end (17 Nov 2026: dandan-general.js version 2): the new inputs' weights start at zero, the net as it was
    grow = net0["XN"] < XN
    if (net0["H1"], net0["H2"], net0.get("H3", 0)) != (H1, H2, H3 if A.form == "head2" else net0.get("H3", 0)) or net0["XN"] > XN: sys.exit(f"--init {A.init}: sizes {net0['XN']}·{net0['H1']}·{net0['H2']}, not {XN}·{H1}·{H2}")
    for k in P:
        if k == "W1" and grow: P[k] = np.zeros_like(P[k]); P[k][:net0["XN"]] = np.asarray(net0[k], dtype=P[k].dtype).reshape(net0["XN"], -1); continue
        P[k] = np.asarray(net0[k], dtype=P[k].dtype).reshape(P[k].shape)
    if grow: print(f"--init {A.init}: the view grown from {net0['XN']} to {XN} inputs, the new ones' weights zero", flush=True)
M = {k: np.zeros_like(v) for k, v in P.items()}
V = {k: np.zeros_like(v) for k, v in P.items()}
# the training-only outputs' own weights (never written; a warm start begins them afresh)
PA = dict(wr=np.zeros(H2), br=np.zeros(1), Wq=U((A.h3, 3), 0.05), bq=np.zeros(3)) if A.form == "head2" else {}
MA = {k: np.zeros_like(v) for k, v in PA.items()}; VA = {k: np.zeros_like(v) for k, v in PA.items()}
sig = lambda v: 1 / (1 + np.exp(-np.clip(v, -30, 30)))
def resp_rows(g):
    """The decisions of batch g whose response is known: their index in the batch and their played move's candidate row."""
    r = RESP[g["idx"]]; k = np.flatnonzero(r >= 0)
    return k, g["target"][k], r[k]


def forward(g):
    x = np.asarray(X[g["idx"]], dtype=np.float32)
    if A.zero_from: x[:, A.zero_from:] = 0
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
    if A.form == "head2":
        pre = (z @ P["W3"] + P["c3"])[g["dec"]] + np.add.reduceat(P["E3"][g["rows"]], g["mstart"], axis=0)
        h = np.maximum(pre, 0)
        f = h @ P["w4"] + np.add.reduceat(P["eb"][g["rows"]], g["mstart"])
        return f, dict(x=x, a1=a1, z=z, pre=pre, h=h)
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
    w = WEIGHT[g["idx"]]
    if A.soft > 0:
        pi = softmax(Q[g["cid"]] / A.soft, g)
        # a decision flagged hard (16, replay-pack2: a line written before each option's move was stored, whose q mix two looks)
        # learns its pick alone (Fable's review, item 8)
        hard = (flags[g["idx"]] & 16) > 0
        if hard.any():
            one = np.zeros_like(pi); one[g["target"]] = 1.0
            pi = np.where(hard[g["dec"]], one, pi)
        loss = -(w[g["dec"]] * pi * np.log(p + 1e-12)).sum()
        df = (p - pi) * w[g["dec"]] / n
    else:
        loss = -(w * np.log(p[g["target"]] + 1e-12)).sum()
        df = p.copy(); df[g["target"]] -= 1; df *= w[g["dec"]] / n
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
        if A.form == "head2":
            G["w4"] = c["h"].T @ df
            dpre = np.outer(df, P["w4"]) * (c["pre"] > 0)
            GA = {}
            if AUX_RC:
                T_ = RC[g["cid"]]; k = np.flatnonzero(T_[:, 0] >= 0)
                if len(k):
                    lq = c["h"][k] @ PA["Wq"] + PA["bq"]; lq -= lq.max(1, keepdims=True); pq = np.exp(lq); pq /= pq.sum(1, keepdims=True)
                    loss += AUX_RC * -(T_[k] * np.log(pq + 1e-12)).sum()
                    dl = (pq - T_[k]) * AUX_RC / n
                    GA["Wq"] = c["h"][k].T @ dl; GA["bq"] = dl.sum(0)
                    np.add.at(dpre, k, (dl @ PA["Wq"].T) * (c["pre"][k] > 0))
            if AUX_RESP:
                k, rows, y = resp_rows(g)
                if len(k):
                    lq = c["h"][rows] @ PA["Wq"] + PA["bq"]; lq -= lq.max(1, keepdims=True); pq = np.exp(lq); pq /= pq.sum(1, keepdims=True)
                    loss += AUX_RESP * -np.log(pq[np.arange(len(k)), y] + 1e-12).sum()
                    dl = pq.copy(); dl[np.arange(len(k)), y] -= 1; dl *= AUX_RESP / n
                    GA["Wq"] = c["h"][rows].T @ dl; GA["bq"] = dl.sum(0)
                    np.add.at(dpre, rows, (dl @ PA["Wq"].T) * (c["pre"][rows] > 0))
            G["E3"] = np.zeros_like(P["E3"]); np.add.at(G["E3"], g["rows"], dpre[g["mcand"]])
            dA = np.add.reduceat(dpre, g["cstart"], axis=0)
            G["W3"] = c["z"].T @ dA; G["c3"] = dA.sum(0)
            dz = (dA @ P["W3"].T) * (c["z"] > 0)
            if AUX_RES:
                y = RES[g["idx"]]; pr = sig(c["z"] @ PA["wr"] + PA["br"][0])
                loss += AUX_RES * -(y * np.log(pr + 1e-9) + (1 - y) * np.log(1 - pr + 1e-9)).sum()
                dr = (pr - y) * AUX_RES / n
                GA["wr"] = c["z"].T @ dr; GA["br"] = np.array([dr.sum()])
                dz += np.outer(dr, PA["wr"]) * (c["z"] > 0)
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
        P[k] -= LR[0] * (M[k] / (1 - b1 ** t)) / (np.sqrt(V[k] / (1 - b2 ** t)) + 1e-8)
    for k, gk in (GA.items() if A.form == "head2" else ()):
        MA[k] = b1 * MA[k] + (1 - b1) * gk; VA[k] = b2 * VA[k] + (1 - b2) * gk ** 2
        PA[k] -= LR[0] * (MA[k] / (1 - b1 ** t)) / (np.sqrt(VA[k] / (1 - b2 ** t)) + 1e-8)
    return loss


def measure(idx):
    """policy-train.mjs's metrics on decisions idx, with agreement by the kind of the search's move and pass/act errors."""
    loss = soft_loss = med_up = mod_up = agree_med = agree_mod = 0.0
    res_loss = res_right = resp_right = resp_n = resp_base = rc_loss = 0.0
    off_n = off_first = 0
    by = {k: [0, 0, 0] for k in KINDS}       # decisions, Medium agrees, the model agrees
    acted = passed = pass_err = act_err = med_pass_err = med_act_err = 0
    for s in range(0, len(idx), 8192):
        g = gather(idx[s:s + 8192])
        f, cm = forward(g)
        p = softmax(f, g)
        loss -= np.log(p[g["target"]] + 1e-12).sum()
        if A.soft > 0: soft_loss -= (softmax(Q[g["cid"]] / A.soft, g) * np.log(p + 1e-12)).sum()
        if AUX_RES:
            y = RES[g["idx"]]; pr = sig(cm["z"] @ PA["wr"] + PA["br"][0])
            res_loss -= (y * np.log(pr + 1e-9) + (1 - y) * np.log(1 - pr + 1e-9)).sum(); res_right += ((pr > 0.5) == (y > 0.5)).sum()
        if AUX_RC:
            T_ = RC[g["cid"]]; k = np.flatnonzero(T_[:, 0] >= 0)
            if len(k):
                lq = cm["h"][k] @ PA["Wq"] + PA["bq"]; lq -= lq.max(1, keepdims=True); pq = np.exp(lq); pq /= pq.sum(1, keepdims=True)
                resp_right += (pq.argmax(1) == T_[k].argmax(1)).sum(); resp_n += len(k); resp_base += (T_[k].argmax(1) == 0).sum()
                rc_loss -= (T_[k] * np.log(pq + 1e-12)).sum()
        if AUX_RESP:
            k, rows, y = resp_rows(g)
            if len(k): resp_right += ((cm["h"][rows] @ PA["Wq"] + PA["bq"]).argmax(1) == y).sum(); resp_n += len(k); resp_base += (y == 0).sum()
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
    aux = {}
    if AUX_RES: aux.update(resultLoss=r4(res_loss / n), resultRight=r4(res_right / n))
    if (AUX_RESP or AUX_RC) and resp_n: aux.update(responseRight=r4(resp_right / resp_n), responseLetResolve=r4(resp_base / resp_n), responses=int(resp_n), **({'responseLoss': r4(rc_loss / resp_n)} if AUX_RC else {}))
    return dict(decisions=n, loss=r4(loss / n), **({"softLoss": r4(soft_loss / n)} if A.soft > 0 else {}), **aux, mediumGivesUp=round(float(100 * med_up / n), 3), modelGivesUp=round(float(100 * mod_up / n), 3),
                mediumAgrees=r4(agree_med / n), modelAgrees=r4(agree_mod / n), offPicks=int(off_n), offFirst=r4(off_first / max(1, off_n)),
                byKind={k: dict(decisions=v[0], mediumAgrees=r4(v[1] / max(1, v[0])), modelAgrees=r4(v[2] / max(1, v[0]))) for k, v in by.items()},
                passWhereActed=dict(model=r4(pass_err / max(1, acted)), medium=r4(med_pass_err / max(1, acted)), of=int(acted)),
                actWherePassed=dict(model=r4(act_err / max(1, passed)), medium=r4(med_act_err / max(1, passed)), of=int(passed)))


KEY = "softLoss" if A.soft > 0 else "loss"
best = dict(measure(held_idx), epoch=0); bestP = {k: v.copy() for k, v in P.items()}
say(f"before training: {json.dumps(best)}")
t = 0
LR = [A.lr]
for e in range(1, A.epochs + 1):
    order = rng.permutation(train_idx)
    tl = 0.0
    for s in range(0, len(order), A.batch):
        t += 1
        tl += step(gather(order[s:s + A.batch]), t)
    h = measure(held_idx)
    say(f"epoch {e}: training loss {tl / len(order):.4f}, held out {json.dumps(h)}")
    LR[0] *= A.decay
    # the epoch kept by the loss the training lowers (18 Nov 2026): with soft targets the held-out loss on the top move alone
    # rewarded the sharp warm-start net, epoch 0 was kept and gm2's policy went unchanged through zl15 and zl16
    if h[KEY] < best[KEY]:
        best = dict(h, epoch=e); bestP = {k: v.copy() for k, v in P.items()}

r5 = lambda a: [round(float(v), 5) for v in np.asarray(a, dtype=np.float64).ravel()]
if A.form == "mlp":   # dandan-netpolicy.js's layout: wx[i·H1 + o], wm[mark·H1 + o], w2[o·H2 + o2]; no Medium-score weights
    net = dict(XN=XN, H1=H1, H2=H2, wx=r5(bestP["wx"]), wm=r5(bestP["wm"]), ws=[0] * H1, b1=r5(bestP["b1"]), w2=r5(bestP["w2"]),
               b2=r5(bestP["b2"]), w3=r5(bestP["w3"]))
elif A.form == "head":
    net = dict(XN=XN, H1=H1, H2=H2, W1=r5(bestP["W1"]), c1=r5(bestP["c1"]), W2=r5(bestP["W2"]), c2=r5(bestP["c2"]), E=r5(bestP["E"]),
               eb=r5(bestP["eb"]))
else:   # head2: dandan-netpolicy.js freeScorer reads W3[o2·H3 + o3], E3[mark·H3 + o3]
    net = dict(XN=XN, H1=H1, H2=H2, H3=H3, W1=r5(bestP["W1"]), c1=r5(bestP["c1"]), W2=r5(bestP["W2"]), c2=r5(bestP["c2"]), W3=r5(bestP["W3"]),
               c3=r5(bestP["c3"]), E3=r5(bestP["E3"]), w4=r5(bestP["w4"]), eb=r5(bestP["eb"]))
# the held-out Deep decisions on their own (No. 7 point 7: agreement on held-out Deep decisions beside Medium's), at the best epoch
P.update(bestP)
deep_held = held_idx[(flags[held_idx] & 2) > 0]
deep = measure(deep_held) if len(deep_held) else dict(decisions=0)
g0 = 1 - best["modelGivesUp"] / best["mediumGivesUp"] if best["mediumGivesUp"] > 0 else 0
metrics = dict(best, every=dict(best), deep=deep, games=None, train=int(len(train_idx)), held=int(len(held_idx)), g0Reduction=round(g0, 4), g0Pass=g0 >= 0.25,
               trainer="policy_np.py", form=A.form)
out = dict(alpha=0, beta=0, medium=False, **({"form": A.form} if A.form != "mlp" else {}), net=net, metrics=metrics)
open(A.out, "w").write(json.dumps(out) + "\n")
say(f"best epoch {best['epoch']}: {json.dumps(best)}")
if A.init and best["epoch"] == 0: say("WARNING: no epoch beat the warm start: the net written is the warm start, unchanged")
