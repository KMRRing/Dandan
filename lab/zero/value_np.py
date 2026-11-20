"""Zero's value net on NumPy (14 Nov 2026, Fable No. 12): results only. The chance a seat wins is sigmoid(g(mine) - g(theirs)),
g an MLP with ReLU hidden layers and a linear last layer, mine and theirs the position's features seen from either seat
(dandan-eval.js makeJudge's form), cross-entropy on the result. Adam, batches of 256, the held-out rows (every fifth game) measured
after each epoch, the best epoch kept. Written in dandan-eval.js's layer format (8-bit weights, a scale per output, biases), so
makeJudge reads it.
usage: python3 lab/zero/value_np.py <packed folder> <out> [--shape 64x32] [--epochs 8] [--lr 1e-3] [--seed 1] [--wd 0]
"""
import argparse, base64, json, os, sys, time
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("dir"); ap.add_argument("out")
ap.add_argument("--shape", default="64x32"); ap.add_argument("--epochs", type=int, default=8)
ap.add_argument("--lr", type=float, default=1e-3); ap.add_argument("--seed", type=int, default=1); ap.add_argument("--batch", type=int, default=256)
ap.add_argument("--init", default="")  # warm start from a value net of the same shape (15 Nov 2026), its int8 weights read back
ap.add_argument("--aux", type=float, default=0.0)  # weight of the second output (16 Nov 2026, Zero 2): whether this seat decks out (aux.f32); dropped from the file written
ap.add_argument("--wd", type=float, default=0.0)  # decoupled weight decay a step (14 Nov: the face-up net overfits from epoch 2)
# the future outputs (19 Nov 2026, Korbi: "do both"): this seat's lead in cards in hand and in lands at its next turn's start, and
# the share of the game left (fut.f32, 3 a row, replay-pack2.mjs); squared error, this weight; dropped from the file written
ap.add_argument("--fut", type=float, default=0.0)
# KataGo's auxiliary targets (20 Nov 2026, Korbi: "yep go"): the game's end (end.f32, 4 a row: life lead, library left, ended on
# life, the other decked; KataGo's score) and the fate of this seat's cards in hand (fate.f32, 2 a card type: used, sent back;
# KataGo's ownership); squared error, these weights; dropped from the file written
ap.add_argument("--endw", type=float, default=0.0)
ap.add_argument("--fate", type=float, default=0.0)
# the refinement stage (19 Nov 2026): train and measure on the rows from the REFINE batches alone (rf.u8)
ap.add_argument("--refine_only", "--refine-only", dest="refine_only", action="store_true")
# the removal test (18 Nov 2026): inputs from this column on read as zero, so their first-layer weights stay at zero in the file
ap.add_argument("--zero_from", "--zero-from", dest="zero_from", type=int, default=0)
# many value nets on one pack (20 Nov 2026, Korbi): the target mixed at training time from the pack's parts (result.f32, sval.f32,
# svtd.f32: replay-pack2.mjs), the result's share 1 - blend, the search's value here (or, --td, 3 of the seat's turns later) the
# rest where the position was searched; the held-out loss (and so the epoch kept) then on the result alone
ap.add_argument("--blend", type=float, default=None)
ap.add_argument("--td", action="store_true")
# a subset of the view (20 Nov 2026): a JSON file of the columns kept (dandan-general.js viewColumns), written into the net
ap.add_argument("--cols", default="")
A = ap.parse_args()
say = lambda m: print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)
meta = json.load(open(os.path.join(A.dir, "meta.json"))); N, R = meta["N"], meta["rows"]
rd = lambda n, t: np.fromfile(os.path.join(A.dir, n), dtype=t)
# the general encoding (17 Nov 2026): 16-bit floats, read in place (a memory map) and widened a batch at a time
if os.path.exists(os.path.join(A.dir, "mine.f16")):
    mm = lambda n: np.memmap(os.path.join(A.dir, n), dtype=np.float16, mode="r", shape=(R, N))
    M, T = mm("mine.f16"), mm("theirs.f16")
else:
    M, T = rd("mine.f32", np.float32).reshape(R, N), rd("theirs.f32", np.float32).reshape(R, N)
Y, H = rd("won.f32", np.float32), rd("hold.u8", np.uint8) > 0
YH = Y   # the held-out target
if A.blend is not None:
    if not os.path.exists(os.path.join(A.dir, "result.f32")): sys.exit("--blend: the pack has no result.f32 (replay-pack2.mjs since 20 Nov)")
    RES, SV = rd("result.f32", np.float32), rd("svtd.f32" if A.td else "sval.f32", np.float32)
    Y = np.where(SV >= 0, (1 - A.blend) * RES + A.blend * SV, RES).astype(np.float32); YH = RES
COLS = np.asarray(json.load(open(A.cols)), np.int64) if A.cols else None
if COLS is not None: say(f"{len(COLS)} of the view's {N} columns read ({A.cols})")
tr, he = np.flatnonzero(~H), np.flatnonzero(H)
if A.refine_only:
    if not os.path.exists(os.path.join(A.dir, "rf.u8")): sys.exit("--refine_only: the pack has no rf.u8 (REFINE)")
    RF = rd("rf.u8", np.uint8) > 0; tr, he = tr[RF[tr]], he[RF[he]]
def xin(a):
    z = np.asarray(a, dtype=np.float32)
    if COLS is not None: z = z[:, COLS]
    if A.zero_from: z[:, A.zero_from:] = 0
    return z
AUX = rd("aux.f32", np.float32) if A.aux and os.path.exists(os.path.join(A.dir, "aux.f32")) else None
def target(name, width, weight):
    """A squared-error output group, or None: (rows × width targets, weight)."""
    if not weight: return None
    if not os.path.exists(os.path.join(A.dir, name)): say(f"WARNING: {name} asked for, but the pack has none: trained without it"); return None
    return rd(name, np.float32).reshape(R, width), weight
# the last layer: the value, then the deck-out logit (--aux), then the squared-error groups in this order; all but the value read
# from this seat's side only, and only the value is written
REG = [t for t in (target("fut.f32", 3, A.fut), target("end.f32", 4, A.endw), target("fate.f32", int(meta.get("fateN", 52)), A.fate)) if t]
IA = 1
OFF = [1 + (AUX is not None)]
for y, _ in REG: OFF.append(OFF[-1] + y.shape[1])
OUT = OFF[-1]
NI = N if COLS is None else len(COLS)
sizes = [NI] + [int(x) for x in A.shape.split("x")] + [OUT]
rng = np.random.default_rng(A.seed)
W = [rng.normal(0, np.sqrt(2 / a), (a, b)) for a, b in zip(sizes[:-1], sizes[1:])]; B = [np.zeros(b) for b in sizes[1:]]
if A.init:
    L0 = json.load(open(A.init))["layers"]
    # a view grown at its end (dandan-general.js version 2): the first layer's new input rows start at zero
    want = [[a, b] for a, b in zip(sizes[:-1], sizes[1:-1] + [1])]; got = [l["n"] for l in L0]
    if COLS is not None and got[0][0] == N: want[0][0] = N   # a full-view net's first layer, cut to the columns below
    if got[1:] != want[1:] or got[0][1] != want[0][1] or got[0][0] > want[0][0]: sys.exit(f"--init {A.init}: layers {got}, not the shape {sizes}")
    W = [np.frombuffer(base64.b64decode(l["q"]), np.int8).reshape(l["n"]).astype(np.float64) * np.asarray(l["s"]) for l in L0]
    if got[0][0] < want[0][0]: W[0] = np.concatenate([W[0], np.zeros((want[0][0] - got[0][0], W[0].shape[1]))], 0); print(f"--init {A.init}: the view grown from {got[0][0]} to {want[0][0]} inputs", flush=True)
    B = [np.asarray(l["b"], np.float64) if l["b"] else np.zeros(l["n"][1]) for l in L0]
    if COLS is not None and W[0].shape[0] == N: W[0] = W[0][COLS]
    if OUT > 1: W[-1] = np.concatenate([W[-1], np.zeros((W[-1].shape[0], OUT - 1))], 1); B[-1] = np.concatenate([B[-1][:1], np.zeros(OUT - 1)])
mW = [np.zeros_like(w) for w in W]; vW = [np.zeros_like(w) for w in W]; mB = [np.zeros_like(b) for b in B]; vB = [np.zeros_like(b) for b in B]
say(f"{R} rows ({len(tr)} training, {len(he)} held out), {NI} inputs, shape {A.shape}")

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
        d = g(xin(M[j]))[-1][:, 0] - g(xin(T[j]))[-1][:, 0]
        p = 1 / (1 + np.exp(-np.clip(d, -30, 30)))
        out += -(YH[j] * np.log(p + 1e-9) + (1 - YH[j]) * np.log(1 - p + 1e-9)).sum()
    return out / max(1, len(idx))

def back(hs, gout):
    gW, gB, gz = [None] * len(W), [None] * len(W), gout
    for l in range(len(W) - 1, -1, -1):
        gW[l] = hs[l].T @ gz; gB[l] = gz.sum(0)
        if l: gz = (gz @ W[l].T) * (hs[l] > 0)
    return gW, gB

best, bestW, t = loss_of(he), ([w.copy() for w in W], [b.copy() for b in B]), 0
bestE = 0
say(f"before training: held-out loss {best:.4f}")
for e in range(1, A.epochs + 1):
    order = rng.permutation(tr)
    for s in range(0, len(order), A.batch):
        j = order[s:s + A.batch]; t += 1
        hm, ht = g(xin(M[j])), g(xin(T[j]))
        d = hm[-1][:, 0] - ht[-1][:, 0]
        p = 1 / (1 + np.exp(-np.clip(d, -30, 30)))
        gd = ((p - Y[j]) / len(j))[:, None]
        gm, gt = np.zeros((len(j), OUT)), np.zeros((len(j), OUT))
        gm[:, :1], gt[:, :1] = gd, -gd
        if AUX is not None: gm[:, IA] = A.aux * (1 / (1 + np.exp(-np.clip(hm[-1][:, IA], -30, 30))) - AUX[j]) / len(j)
        for (y, w), a, b in zip(REG, OFF, OFF[1:]): gm[:, a:b] = w * 2 * (hm[-1][:, a:b] - y[j]) / len(j)
        aW, aB = back(hm, gm); bW, bB = back(ht, gt)
        for l in range(len(W)):
            for P_, G_, m_, v_ in ((W, aW[l] + bW[l], mW, vW), (B, aB[l] + bB[l], mB, vB)):
                m_[l] = 0.9 * m_[l] + 0.1 * G_; v_[l] = 0.999 * v_[l] + 0.001 * G_ ** 2
                P_[l] -= A.lr * (m_[l] / (1 - 0.9 ** t)) / (np.sqrt(v_[l] / (1 - 0.999 ** t)) + 1e-8)
            if A.wd: W[l] *= 1 - A.lr * A.wd
    h = loss_of(he)
    say(f"epoch {e}: held-out loss {h:.4f}")
    if h < best: best, bestW, bestE = h, ([w.copy() for w in W], [b.copy() for b in B]), e

Wb, Bb = bestW
if OUT > 1:   # the value output alone is kept: the other outputs only shaped the layers below it
    Wb = Wb[:-1] + [Wb[-1][:, :1]]; Bb = Bb[:-1] + [Bb[-1][:1]]
layers = []
for l, (w, b) in enumerate(zip(Wb, Bb)):
    sc = np.maximum(np.abs(w).max(0), 1e-8) / 127
    q = np.clip(np.round(w / sc), -127, 127).astype(np.int8)
    layers.append(dict(n=[int(w.shape[0]), int(w.shape[1])], q=base64.b64encode(q.tobytes()).decode(), s=[float(round(x, 8)) for x in sc], b=[float(round(x, 6)) for x in b] if l < len(Wb) - 1 else []))
json.dump(dict(source="lab/zero/value_np.py", note=f"Zero value net, {A.shape}, {R} rows", metrics=dict(heldLoss=round(float(best), 4), rows=int(R), epoch=bestE), layers=layers, **({"cols": COLS.tolist()} if COLS is not None else {})), open(A.out, "w"))
open(A.out, "a").write("\n")
say(f"best held-out loss {best:.4f} at epoch {bestE} (a coin: 0.6931)")
# the scorecard's other numbers on the held-out rows with the net kept (18 Nov 2026): Brier and how often the favourite wins
W, B = [w.copy() for w in Wb], [b.copy() for b in Bb]
if len(he):
    ps = []
    for s0 in range(0, len(he), 65536):
        j = he[s0:s0 + 65536]
        d = g(xin(M[j]))[-1][:, 0] - g(xin(T[j]))[-1][:, 0]
        ps.append(1 / (1 + np.exp(-np.clip(d, -30, 30))))
    p_ = np.concatenate(ps); y_ = YH[he]
    say(f"scorecard: rows {len(he)}, log loss {best:.4f}, Brier {float(((p_ - y_) ** 2).mean()):.4f}, favourite right {float(((p_ > 0.5) == (y_ > 0.5)).mean()):.4f}")
    # the late game (20 Nov 2026): the same on the held-out rows with 10 cards or fewer left in the library (lib.u8)
    ll = lambda p, y: float(-(y * np.log(p + 1e-9) + (1 - y) * np.log(1 - p + 1e-9)).mean())
    late = ""
    if os.path.exists(os.path.join(A.dir, "lib.u8")):
        m = rd("lib.u8", np.uint8)[he] <= 10
        if m.any(): late = f", library <= 10: rows {int(m.sum())}, log loss {ll(p_[m], y_[m]):.4f}"
    print(f"SWEEP {os.path.basename(A.out)}: held-out result log loss {ll(p_, y_):.4f}{late}, epoch {bestE}", flush=True)
if A.init and bestE == 0: say("WARNING: no epoch beat the warm start: the net written is the warm start, unchanged")
