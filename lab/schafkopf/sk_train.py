"""Schafkopf's first auxiliary reading (Fable, 24 Nov 2026 20:38Z): on ska-self's rows (lab/schafkopf/sk-pack.mjs), a held-out
tenth by deal, train
  value and policy, four arms each: raw | raw + aux inputs | raw + aux outputs | both
  the dealer (who holds each unseen card), raw | raw + aux inputs
and print the held-out losses: value in tariffs (RMSE of the payoff per seat), policy as cross-entropy against the search's
targets and agreement with the search's pick, the aux heads' own losses, and the dealer's share of unseen cards placed with the
right holder by trick, against the count-only baseline (each card to a seat in proportion to the cards it has left).
The value head gives the payoff per relative seat ÷ MAX_PAYOFF, linear, centred to sum to zero (zero-sum; no sigmoid, so a big
solo is worth what it pays). Aux outputs (e) side points, (f) holder of each unseen card, (g) the open trick's winner, weight AUXW.
usage: python3 lab/schafkopf/sk_train.py <pack dir> [--epochs 6] [--h 256,128] [--lr 1e-3] [--auxw 0.1] [--out <dir for nets>]
"""
import argparse, json, os, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ap = argparse.ArgumentParser()
ap.add_argument("pack"); ap.add_argument("--epochs", type=int, default=6); ap.add_argument("--h", default="256,128")
ap.add_argument("--lr", type=float, default=1e-3); ap.add_argument("--wd", type=float, default=1e-4); ap.add_argument("--auxw", type=float, default=0.1)
ap.add_argument("--bs", type=int, default=512); ap.add_argument("--out", default=""); ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--world", action="store_true", help="Fable 23:58Z: the world-view value net (XW) beside the seat-view raw net, at the given settings")
ap.add_argument("--sweep", action="store_true", help="Fable 23:28Z: the value net alone, raw and both arms, epochs 1-3 x wd 1e-4/1e-3 x lr as given and a third")
a = ap.parse_args()
torch.manual_seed(a.seed); np.random.seed(a.seed); torch.set_num_threads(os.cpu_count() or 2)
meta = json.load(open(os.path.join(a.pack, "meta.json")))
N, R, A, ACT, C = meta["rows"], meta["raw"], meta["aux"], meta["actions"], meta["cards"]
rd = lambda k, t, w=1: np.fromfile(os.path.join(a.pack, k), dtype=t).reshape(N, w) if w > 1 else np.fromfile(os.path.join(a.pack, k), dtype=t)
X = rd("X", np.uint8, R + A); M = rd("M", np.uint8, ACT); P = rd("P", np.float32, ACT); V = rd("V", np.float32, 4)
E = rd("E", np.float32); H = rd("H", np.int8, C); W = rd("W", np.int8); T = rd("T", np.uint8); D = rd("D", np.uint32)
test = (D % 10) == 0
tr, te = np.where(~test)[0], np.where(test)[0]
print(f"sk_train: {N} rows from {meta['deals']} deals; train {len(tr)}, held out {len(te)} (every tenth deal)")

# the raw view's parts, in sk-view.js's order: where the contract's type, the declarer and the phase sit
OFF = {}; _o = 0
for k, n in [("hand", 32), ("history", 32 * 12), ("trick", 128), ("leader", 4), ("toAct", 4), ("bids", 40), ("type", 3), ("trump", 4), ("ace", 3), ("declarer", 4), ("dealer", 4), ("phase", 2)]:
    OFF[k] = _o; _o += n
assert _o == R, (_o, R)
# the declarer's first decision after the bid, per held-out deal (Fable 22:52Z: the value net's verdict on the contract it took)
playing = X[:, OFF["phase"] + 1] > 0
decl_me = X[:, OFF["declarer"]] > 0
first = np.zeros(N, bool); seen_d = set()
for i in np.where(test & playing & decl_me)[0]:
    if D[i] not in seen_d: seen_d.add(D[i]); first[i] = True
ctype = X[:, OFF["type"]:OFF["type"] + 3].argmax(1)
print(f"sk_train: held-out payoff SD per seat (the zero predictor's RMSE): {np.sqrt((V[te] ** 2).mean()) * meta['maxPayoff']:.3f} tariffs")
# hand sizes per relative seat at each row, for the dealer's baseline: 8 less the cards each has played (raw history's seat bits)
hist = X[:, C:C + C * 12].reshape(N, C, 12)
played = (hist[:, :, 8:12] > 0).sum(1)
left = np.clip(8 - played, 0, 8).astype(np.float32)          # (N, 4): seat 0 is the viewer itself

def body(n_in, hs):
    layers, k = [], n_in
    for h in hs: layers += [nn.Linear(k, h), nn.ReLU()]; k = h
    return nn.Sequential(*layers), k

class Net(nn.Module):
    def __init__(self, n_in, main, aux_out):
        super().__init__()
        self.body, k = body(n_in, [int(h) for h in a.h.split(",")])
        self.main = nn.Linear(k, main)
        self.aux = nn.ModuleDict({"e": nn.Linear(k, 1), "f": nn.Linear(k, C * 4), "g": nn.Linear(k, 4)}) if aux_out else None
    def forward(self, x):
        z = self.body(x)
        return self.main(z), ({n: m(z) for n, m in self.aux.items()} if self.aux is not None else None)

XW = np.fromfile(os.path.join(a.pack, "XW"), dtype=np.uint8).reshape(N, 4 * R) if a.world else None
def batch(ix, n_in):
    if n_in == 4 * R: return torch.from_numpy(XW[ix].astype(np.float32) / 255)
    return torch.from_numpy(X[ix, :n_in].astype(np.float32) / 255)

def aux_loss(o, ix):
    """(e) MSE, (f) cross-entropy over the four seats where the card is unseen, (g) cross-entropy where a trick is open."""
    e = F.mse_loss(o["e"].squeeze(1), torch.from_numpy(E[ix]))
    h = torch.from_numpy(H[ix].astype(np.int64)); fm = h >= 0
    f = F.cross_entropy(o["f"].view(-1, C, 4)[fm], h[fm]) if fm.any() else torch.tensor(0.)
    w = torch.from_numpy(W[ix].astype(np.int64)); gm = w >= 0
    g = F.cross_entropy(o["g"][gm], w[gm]) if gm.any() else torch.tensor(0.)
    return e, f, g

def masked_logp(logits, ix):
    m = torch.from_numpy(M[ix].astype(bool))
    return F.log_softmax(logits.masked_fill(~m, -1e9), 1)

def run(kind, inputs, outputs, world=False):
    n_in = 4 * R if world else R + (A if inputs else 0)
    main = {"value": 4, "policy": ACT, "dealer": C * 4}[kind]
    net = Net(n_in, main, outputs)
    opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=a.wd)
    t0 = time.time()
    def loss_of(ix, train=True):
        x = batch(ix, n_in); y, o = net(x)
        if kind == "value":
            y = y - y.mean(1, keepdim=True)
            l = F.mse_loss(y, torch.from_numpy(V[ix]))
        elif kind == "policy":
            l = -(torch.from_numpy(P[ix]) * masked_logp(y, ix)).sum(1).mean()
        else:
            h = torch.from_numpy(H[ix].astype(np.int64)); fm = h >= 0
            l = F.cross_entropy(y.view(-1, C, 4)[fm], h[fm])
        if o is not None and train:
            e, f, g = aux_loss(o, ix); l = l + a.auxw * (e + f + g)
        return l, y, o
    for ep in range(a.epochs):
        net.train(); perm = np.random.permutation(tr)
        for b in range(0, len(perm), a.bs):
            l, _, _ = loss_of(perm[b:b + a.bs]); opt.zero_grad(); l.backward(); opt.step()
    net.eval()
    with torch.no_grad():
        out = {"main": 0., "agree": 0., "e": 0., "f": 0., "g": 0., "n": 0}
        right = np.zeros(9); base = np.zeros(9); cnt = np.zeros(9)
        for b in range(0, len(te), 4096):
            ix = te[b:b + 4096]; l, y, o = loss_of(ix, train=False); n = len(ix)
            out["main"] += l.item() * n; out["n"] += n
            if kind == "policy":
                out["agree"] += (y.masked_fill(~torch.from_numpy(M[ix].astype(bool)), -1e9).argmax(1).numpy() == P[ix].argmax(1)).sum()
            if o is not None:
                e, f, g = aux_loss(o, ix); out["e"] += e.item() * n; out["f"] += f.item() * n; out["g"] += g.item() * n
            if kind == "dealer":
                pr = y.view(-1, C, 4).numpy(); pr[:, :, 0] = -1e9           # never the viewer itself
                h = H[ix]; fm = h >= 0; guess = pr.argmax(2)
                bl = np.broadcast_to(left[ix][:, None, 1:], (n, C, 3)).argmax(2) + 1   # the count baseline: the seat with most cards left
                for t in range(9):
                    sel = fm & (T[ix][:, None] == t)
                    right[t] += (guess[sel] == h[sel]).sum(); base[t] += (bl[sel] == h[sel]).sum(); cnt[t] += sel.sum()
    k = out["n"]
    res = {"kind": kind, "inputs": "world" if world else "raw+aux" if inputs else "raw", "outputs": "aux" if outputs else "-", "seconds": round(time.time() - t0)}
    if kind == "value":
        res["rmse_tariffs"] = float(np.sqrt(out["main"] / k) * meta["maxPayoff"])
        ix = np.where(first)[0]
        with torch.no_grad():
            y, _ = net(batch(ix, n_in)); y = (y - y.mean(1, keepdim=True))[:, 0].numpy() * meta["maxPayoff"]
        real = V[ix, 0] * meta["maxPayoff"]
        # held-out RMSE by tricks played, against the zero predictor's (Fable 23:28Z: the net sees the seat's view, not the deal)
        with torch.no_grad():
            yy, _ = net(batch(te, n_in)); yy = (yy - yy.mean(1, keepdim=True)).numpy()
        err = ((yy - V[te]) ** 2).mean(1); zero = (V[te] ** 2).mean(1)
        res["by_trick"] = [[t, round(float(np.sqrt(err[T[te] == t].mean()) * meta["maxPayoff"]), 2), round(float(np.sqrt(zero[T[te] == t].mean()) * meta["maxPayoff"]), 2)] for t in range(9) if (T[te] == t).any()]
        res["after_bid"] = {t: [int((ctype[ix] == j).sum()), round(float(y[ctype[ix] == j].mean()), 2), round(float(real[ctype[ix] == j].mean()), 2)]
                            for j, t in enumerate(["sau", "wenz", "solo"]) if (ctype[ix] == j).any()}   # [deals, predicted, real] for the declarer
    if kind == "policy": res["ce"] = out["main"] / k; res["agree"] = out["agree"] / k
    if kind == "dealer":
        res["ce"] = out["main"] / k
        res["right"] = float(right.sum() / max(1, cnt.sum())); res["baseline"] = float(base.sum() / max(1, cnt.sum()))
        res["by_trick"] = [[t, round(right[t] / cnt[t], 3), round(base[t] / cnt[t], 3)] for t in range(9) if cnt[t]]
    if outputs: res.update({"aux_e_mse": out["e"] / k, "aux_f_ce": out["f"] / k, "aux_g_ce": out["g"] / k})
    print(json.dumps(res), flush=True)
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        torch.save(net.state_dict(), os.path.join(a.out, f"{kind}-{res['inputs']}-{res['outputs'].replace('-', 'none')}.pt"))
        lin = [m for m in net.body if isinstance(m, nn.Linear)] + [net.main]
        js = {"kind": kind, "inputs": res["inputs"], "outputs": res["outputs"], "n_in": n_in, "maxPayoff": meta["maxPayoff"],
              "layers": [{"w": m.weight.detach().numpy().round(6).tolist(), "b": m.bias.detach().numpy().round(6).tolist()} for m in lin]}
        json.dump(js, open(os.path.join(a.out, f"{kind}-{res['inputs']}-{res['outputs'].replace('-', 'none')}.json"), "w"))
    return res

results = []
if a.world:
    run("value", False, False); run("value", False, False, world=True)
    print("sk_train: done"); raise SystemExit
if a.sweep:
    lr0 = a.lr
    for inputs, outputs in ((False, False), (True, True)):
        for ep in (1, 2, 3):
            for wd in (1e-4, 1e-3):
                for lr in (lr0, lr0 / 3):
                    a.epochs, a.wd, a.lr = ep, wd, lr
                    r = run("value", inputs, outputs)
                    print(json.dumps({"sweep": True, "inputs": r["inputs"], "outputs": r["outputs"], "epochs": ep, "wd": wd, "lr": lr, "rmse": round(r["rmse_tariffs"], 3), "late": r["by_trick"][-1]}), flush=True)
    print("sk_train: done"); raise SystemExit
for kind in ("value", "policy"):
    for inputs in (False, True):
        for outputs in (False, True):
            results.append(run(kind, inputs, outputs))
for inputs in (False, True):
    results.append(run("dealer", inputs, False))
print("sk_train: done")
