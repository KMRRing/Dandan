# Nets grown onto the general view's version 2 (17 Nov 2026, Korbi 17:27 "go full general"): the policy's and the value net's
# first layer given zero weights on the inputs version 2 adds (dandan-general.js), so the grown nets play exactly as before and
# training learns the new inputs from there. Written as lab/zero/nets/<new>-gpolicy.json and -gvalue.json; with --scryg <name> the
# general dealer <name>-scryg.json is copied as <new>-scryg.json.
# usage: python3 lab/zero/grow-view.py <old> <new> <inputs, version 2's view size> [--scryg <name>]
import argparse, base64, json, shutil, numpy as np
ap = argparse.ArgumentParser(); ap.add_argument("old"); ap.add_argument("new"); ap.add_argument("xn", type=int); ap.add_argument("--scryg", default="")
A = ap.parse_args(); D = "lab/zero/nets/"
p = json.load(open(f"{D}{A.old}-gpolicy.json")); n = p["net"]; X0 = n["XN"]
if X0 < A.xn:
    W = np.asarray(n["W1"]).reshape(X0, -1); W2 = np.zeros((A.xn, W.shape[1])); W2[:X0] = W; n["W1"] = W2.ravel().tolist(); n["XN"] = A.xn
json.dump(p, open(f"{D}{A.new}-gpolicy.json", "w"))
v = json.load(open(f"{D}{A.old}-gvalue.json")); L0 = v["layers"][0]; nin, nout = L0["n"]
if nin < A.xn:
    q = np.frombuffer(base64.b64decode(L0["q"]), np.int8).reshape(nin, nout); q2 = np.zeros((A.xn, nout), np.int8); q2[:nin] = q
    L0["q"] = base64.b64encode(q2.tobytes()).decode(); L0["n"] = [A.xn, nout]
json.dump(v, open(f"{D}{A.new}-gvalue.json", "w"))
if A.scryg: shutil.copy(f"{D}{A.scryg}-scryg.json", f"{D}{A.new}-scryg.json")
print(f"{A.new}: policy and value grown from {X0} and {nin} inputs to {A.xn}" + (f", the dealer {A.scryg}" if A.scryg else ""))
