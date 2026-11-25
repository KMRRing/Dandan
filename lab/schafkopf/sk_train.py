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
ap.add_argument("--policy-only", dest="policy_only", action="store_true", help="the raw policy alone (its agreement and regret)")
ap.add_argument("--value-only", dest="value_only", action="store_true", help="Fable 03:12Z: the raw seat-view value net alone, at the given settings (for the bid's value mix)")
ap.add_argument("--policy-sweep", dest="policy_sweep", action="store_true", help="Fable 03:12Z: the raw policy at epochs E and 4E x width 256,128 and 512,256, each exported as policy-e<ep>-w<width>.json")
ap.add_argument("--world-aux", dest="world_aux", action="store_true", help="also the world view with the seat's aux inputs")
ap.add_argument("--world", action="store_true", help="Fable 23:58Z: the world-view value net (XW) beside the seat-view raw net, at the given settings")
ap.add_argument("--bh", default="64", help="M1: the belief nets' hidden widths (small: they run at every play-out move)")
ap.add_argument("--m1-value", dest="m1_value", action="store_true", help="M1: the value nets too")
ap.add_argument("--played", action="store_true", help="Fable 25 Nov 19:00Z: the played move's real result, a payoff head per legal move trained only on the move played, on raw + the M1 inputs, at 1 and 3 epochs (trainer only)")
ap.add_argument("--m1", action="store_true", help="Fable 25 Nov 16:20Z, step 1: the two partner-belief nets (own view; public record), frozen, then the policy and value on raw + partner facts + both beliefs (engine M1)")
ap.add_argument("--sweep", action="store_true", help="Fable 23:28Z: the value net alone, raw and both arms, epochs 1-3 x wd 1e-4/1e-3 x lr as given and a third")
a = ap.parse_args()
torch.manual_seed(a.seed); np.random.seed(a.seed); torch.set_num_threads(os.cpu_count() or 2)
meta = json.load(open(os.path.join(a.pack, "meta.json")))
N, R, A, ACT, C = meta["rows"], meta["raw"], meta["aux"], meta["actions"], meta["cards"]
rd = lambda k, t, w=1: np.fromfile(os.path.join(a.pack, k), dtype=t).reshape(N, w) if w > 1 else np.fromfile(os.path.join(a.pack, k), dtype=t)
X = rd("X", np.uint8, R + A); M = rd("M", np.uint8, ACT); P = rd("P", np.float32, ACT); V = rd("V", np.float32, 4)
E = rd("E", np.float32); H = rd("H", np.int8, C); W = rd("W", np.int8); T = rd("T", np.uint8); D = rd("D", np.uint32)
test = (D % 10) == 0
PART = meta.get("part", 0)
Q = rd("Q", np.uint8, PART) if PART and os.path.exists(os.path.join(a.pack, "Q")) else None
AH = rd("A", np.int8) if Q is not None else None
PLAYED = os.path.exists(os.path.join(a.pack, "PL"))
PL, KD, QM = (rd("PL", np.uint8), rd("K", np.uint8), rd("QM", np.uint8, ACT)) if PLAYED else (None, None, None)
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
    def __init__(self, n_in, main, aux_out, hs=None):
        super().__init__()
        self.body, k = body(n_in, [int(h) for h in (hs or a.h).split(",")])
        self.main = nn.Linear(k, main)
        self.aux = nn.ModuleDict({"e": nn.Linear(k, 1), "f": nn.Linear(k, C * 4), "g": nn.Linear(k, 4)}) if aux_out else None
    def forward(self, x):
        z = self.body(x)
        return self.main(z), ({n: m(z) for n, m in self.aux.items()} if self.aux is not None else None)

XW = np.fromfile(os.path.join(a.pack, "XW"), dtype=np.uint8).reshape(N, 4 * R) if a.world else None
def batch(ix, n_in):
    if n_in == 4 * R: return torch.from_numpy(XW[ix].astype(np.float32) / 255)
    if n_in == 4 * R + A: return torch.from_numpy(np.concatenate([XW[ix], X[ix, R:R + A]], 1).astype(np.float32) / 255)
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
    n_in = (4 * R + (A if inputs else 0)) if world else R + (A if inputs else 0)
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
                top = y.masked_fill(~torch.from_numpy(M[ix].astype(bool)), -1e9).argmax(1).numpy()
                out["agree"] += (top == P[ix].argmax(1)).sum()
                # regret (Fable 07:50Z): the search's mean for its best move less its mean for the policy's top move. The target is
                # softmax(mean / TAU), so mean_i - mean_best = TAU * ln(P_i / P_best) exactly; in tariffs at SD 5.5 (x 2 SD a value unit)
                pt = P[ix][np.arange(len(ix)), top]; pb = P[ix].max(1)
                rg = -meta["tau"] * np.log(np.maximum(pt, 1e-30) / pb) * 2 * 5.5
                bid = X[ix, OFF["phase"]] > 0
                out.setdefault("regret", []).append(rg); out.setdefault("rbid", []).append(bid)
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
    res = {"kind": kind, "inputs": ("world+aux" if inputs else "world") if world else "raw+aux" if inputs else "raw", "outputs": "aux" if outputs else "-", "seconds": round(time.time() - t0)}
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
    if kind == "policy":
        res["ce"] = out["main"] / k; res["agree"] = out["agree"] / k
        rg = np.concatenate(out["regret"]); bid = np.concatenate(out["rbid"])
        res["regret_tariffs"] = {"all": round(float(rg.mean()), 4), "bid": round(float(rg[bid].mean()), 4), "card": round(float(rg[~bid].mean()), 4), "bid_rows": int(bid.sum())}
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
        name = getattr(a, "tag", None) or f"{kind}-{res['inputs']}-{res['outputs'].replace('-', 'none')}"
        json.dump(js, open(os.path.join(a.out, f"{name}.json"), "w"))
    return res

# ---------------------------------------------------------------- M1 (Fable 25 Nov 2026 16:20Z, step 1; Korbi: inputs and outputs only)
# Two belief nets over who holds the called ace (relative seat), each a softmax over the four seats masked by what is exact:
#   own: the seat's view (raw) and the partner facts, masked by the own mask (Q 4..7)
#   public: the raw view with the hand blanked and the own mask zeroed, masked by the public mask (Q 0..3): an onlooker's belief,
#     what the other side can know
# Trained on Sauspiel play rows (A >= 0), then frozen; their eight outputs join raw + the partner facts as the policy's and the
# value's inputs. Outside a Sauspiel's play both masks are empty and the beliefs zero.
def belief_inputs(ix, public):
    x = np.concatenate([X[ix, :R], Q[ix]], 1).astype(np.float32) / 255
    if public: x[:, :32] = 0; x[:, R + 4:R + 8] = 0
    return torch.from_numpy(x)
def masked_soft(logits, mask):
    m = mask > 0
    p = F.softmax(logits.masked_fill(~m, -1e9), 1)
    return p * m.any(1, keepdim=True)
def bel_mask(ix, public): return torch.from_numpy(Q[ix][:, 0:4] if public else Q[ix][:, 4:8])

def train_belief(public):
    rows = np.where(AH >= 0)[0]; btr = np.intersect1d(rows, tr); bte = np.intersect1d(rows, te)
    net = Net(R + PART, 4, False, a.bh); opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=a.wd); t0 = time.time()
    def lossb(ix):
        y, _ = net(belief_inputs(ix, public)); m = bel_mask(ix, public) > 0
        return F.cross_entropy(y.masked_fill(~m, -1e9), torch.from_numpy(AH[ix].astype(np.int64))), y, m
    for ep in range(a.epochs):
        net.train(); perm = np.random.permutation(btr)
        for b in range(0, len(perm), a.bs):
            l, _, _ = lossb(perm[b:b + a.bs]); opt.zero_grad(); l.backward(); opt.step()
    net.eval(); ce = n = right = base_ce = 0.; by = {}
    with torch.no_grad():
        for b in range(0, len(bte), 4096):
            ix = bte[b:b + 4096]; l, y, m = lossb(ix); k = len(ix); ce += l.item() * k; n += k
            guess = y.masked_fill(~m, -1e9).argmax(1).numpy(); right += (guess == AH[ix]).sum()
            cnt = m.sum(1).float().numpy(); base_ce += np.log(cnt).sum()               # uniform over the exact mask
            open_ = cnt > 1
            for t in range(8):
                sel = open_ & (T[ix] == t)
                if sel.any():
                    d = by.setdefault(t, [0, 0, 0.]); d[0] += int(sel.sum()); d[1] += int((guess[sel] == AH[ix][sel]).sum()); d[2] += float(np.log(cnt[sel]).sum())
    res = {"kind": "belief", "view": "public" if public else "own", "rows": int(len(btr)), "ce": round(float(ce / n), 4), "uniform_ce": round(float(base_ce / n), 4), "right": round(float(right / n), 4),
           "open_by_trick": {t: [d[0], round(d[1] / d[0], 3)] for t, d in sorted(by.items())}, "seconds": round(time.time() - t0)}
    print(json.dumps(res), flush=True)
    return net

def net_json(net, kind, inputs, n_in, extra=None):
    lin = [m for m in net.body if isinstance(m, nn.Linear)] + [net.main]
    j = {"kind": kind, "inputs": inputs, "outputs": "-", "n_in": n_in, "maxPayoff": meta["maxPayoff"],
         "layers": [{"w": m.weight.detach().numpy().round(6).tolist(), "b": m.bias.detach().numpy().round(6).tolist()} for m in lin]}
    if extra: j.update(extra)
    return j

if a.m1 or a.played:
    assert Q is not None, "pack without the partner facts (Q, A): repack with the current sk-pack.mjs"
    b_own, b_pub = train_belief(False), train_belief(True)
    for b in (b_own, b_pub):
        for q in b.parameters(): q.requires_grad_(False)
    def m1_inputs(ix):
        with torch.no_grad():
            po = masked_soft(b_own(belief_inputs(ix, False))[0], bel_mask(ix, False))
            pp = masked_soft(b_pub(belief_inputs(ix, True))[0], bel_mask(ix, True))
        return torch.cat([torch.from_numpy(np.concatenate([X[ix, :R], Q[ix]], 1).astype(np.float32) / 255), po, pp], 1)
    n_in = R + PART + 8
    beliefs = {"own": net_json(b_own, "belief", "raw+part", R + PART, {"mask": "own"}), "public": net_json(b_pub, "belief", "public+part", R + PART, {"mask": "public"})}
    if a.played:
        assert PLAYED, "pack without PL, K, QM: repack with the current sk-pack.mjs"
        def se(x): return float(x.std(ddof=1) / np.sqrt(len(x))) if len(x) > 1 else float("nan")
        for eps in (1, 3):
            head = Net(n_in, ACT, False); opt = torch.optim.AdamW(head.parameters(), lr=a.lr, weight_decay=a.wd); t0 = time.time()
            def lossp(ix):
                y, _ = head(m1_inputs(ix)); pl = torch.from_numpy(PL[ix].astype(np.int64))
                return F.mse_loss(y.gather(1, pl[:, None]).squeeze(1), torch.from_numpy(V[ix, 0])), y
            for ep in range(eps):
                head.train(); perm = np.random.permutation(tr)
                for b in range(0, len(perm), a.bs):
                    l, _ = lossp(perm[b:b + a.bs]); opt.zero_grad(); l.backward(); opt.step()
            head.eval(); ys = []; tot = 0.
            with torch.no_grad():
                for b in range(0, len(te), 4096):
                    ix = te[b:b + 4096]; l, y = lossp(ix); tot += l.item() * len(ix); ys.append(y.numpy())
            Y = np.concatenate(ys) * meta["maxPayoff"]; Mt = M[te] > 0; Qt = QM[te] > 0; Kt = KD[te]
            res = {"kind": "played", "epochs": eps, "rmse_tariffs": round(float(np.sqrt(tot / len(te)) * meta["maxPayoff"]), 3), "seconds": round(time.time() - t0)}
            for k, name in ((1, "A"), (2, "B")):
                r = np.where(Kt == k)[0]
                if len(r):
                    dq = np.where(Qt[r], Y[r], -1e9).max(1) - np.where(Mt[r] & ~Qt[r], Y[r], -1e9).max(1)
                    res[name] = {"rows": int(len(r)), "questioned_less_best_other": round(float(dq.mean()), 3), "se": round(se(dq), 3),
                                 "head_prefers_questioned": round(float((dq > 0).mean()), 3), "search_chose_questioned": round(float(Qt[r][np.arange(len(r)), P[te][r].argmax(1)].mean()), 3)}
            ht = np.where(Mt, Y, -1e9).argmax(1); st = P[te].argmax(1); dif = ht != st; pl = PL[te]; real = V[te, 0] * meta["maxPayoff"]
            res["differs"] = round(float(dif.mean()), 4)
            a_ = dif & (pl == ht); b_ = dif & (pl == st)
            res["where_they_differ"] = {"played_head_top": [int(a_.sum()), round(float(real[a_].mean()), 3) if a_.any() else None],
                                        "played_search_top": [int(b_.sum()), round(float(real[b_].mean()), 3) if b_.any() else None]}
            print(json.dumps(res), flush=True)
        if not a.m1: print("sk_train: done"); raise SystemExit
    # the policy both ways on the same rows (the raw arm the comparison); the value net only with --m1-value (Monte zero uses none)
    for kind in ("policy", "value") if a.m1_value else ("policy",):
        for inputs in ("raw", "m1"):
            k_in = R if inputs == "raw" else n_in
            net = Net(k_in, ACT if kind == "policy" else 4, False); opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=a.wd); t0 = time.time()
            xin = (lambda ix: torch.from_numpy(X[ix, :R].astype(np.float32) / 255)) if inputs == "raw" else m1_inputs
            def lossm(ix):
                y, _ = net(xin(ix))
                if kind == "value": y = y - y.mean(1, keepdim=True); return F.mse_loss(y, torch.from_numpy(V[ix])), y
                return -(torch.from_numpy(P[ix]) * masked_logp(y, ix)).sum(1).mean(), y
            for ep in range(a.epochs):
                net.train(); perm = np.random.permutation(tr)
                for b in range(0, len(perm), a.bs):
                    l, _ = lossm(perm[b:b + a.bs]); opt.zero_grad(); l.backward(); opt.step()
            net.eval(); tot = n = agree = 0.; rg = []
            with torch.no_grad():
                for b in range(0, len(te), 4096):
                    ix = te[b:b + 4096]; l, y = lossm(ix); tot += l.item() * len(ix); n += len(ix)
                    if kind == "policy":
                        top = y.masked_fill(~torch.from_numpy(M[ix].astype(bool)), -1e9).argmax(1).numpy(); agree += (top == P[ix].argmax(1)).sum()
                        pt = P[ix][np.arange(len(ix)), top]; rg.append(-meta["tau"] * np.log(np.maximum(pt, 1e-30) / P[ix].max(1)) * 2 * 5.5)
            res = {"kind": kind, "inputs": inputs, "seconds": round(time.time() - t0)}
            if kind == "policy": res.update({"ce": round(tot / n, 4), "agree": round(float(agree / n), 4), "regret_tariffs": round(float(np.concatenate(rg).mean()), 4)})
            else: res["rmse_tariffs"] = round(float(np.sqrt(tot / n) * meta["maxPayoff"]), 3)
            print(json.dumps(res), flush=True)
            if a.out and inputs == "m1":
                os.makedirs(a.out, exist_ok=True)
                json.dump(net_json(net, kind, "raw+part", n_in, {"beliefs": beliefs}), open(os.path.join(a.out, f"{kind}-m1.json"), "w"))
    print("sk_train: done"); raise SystemExit

results = []
if a.policy_only:
    run("policy", False, False); print("sk_train: done"); raise SystemExit
if a.value_only:
    run("value", False, False); print("sk_train: done"); raise SystemExit
if a.policy_sweep:
    e0 = a.epochs
    for ep in (e0, 4 * e0):
        for h in ("256,128", "512,256"):
            a.epochs, a.h, a.tag = ep, h, f"policy-e{ep}-w{h.split(',')[0]}"
            r = run("policy", False, False)
            print(json.dumps({"policy_sweep": True, "epochs": ep, "h": h, "ce": round(r["ce"], 4), "agree": round(r["agree"], 4), "seconds": r["seconds"]}), flush=True)
    print("sk_train: done"); raise SystemExit
if a.world:
    run("value", False, False); run("value", False, False, world=True)
    if a.world_aux: run("value", True, False, world=True)   # the target's check: points taken are in the aux inputs
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
