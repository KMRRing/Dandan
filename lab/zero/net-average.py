"""Weight averaging (18 Nov 2026, Korbi: "would using all the data/approaches improve the score?"): nets of one line, trained warm
from the same starting nets, averaged weight by weight into one of the same size (SWA's idea: the average of nearby solutions is
usually a better one). Policy (JSON floats), value (signed bytes with a scale an output, averaged in float and rounded back) and
dealer (Scry G's float arrays); every input net must have the same shapes.
usage: python3 lab/zero/net-average.py <out name> <name> <name>... (lab/zero/nets/<name>-gpolicy/-gvalue/-scryg.json)"""
import base64, json, os, sys
import numpy as np

here = os.path.join(os.path.dirname(__file__), "nets")
out, names = sys.argv[1], sys.argv[2:]
load = lambda n, k: json.load(open(os.path.join(here, f"{n}-{k}.json")))

def avg_tree(trees):
    """Average every list of numbers (any nesting) across same-shaped JSON trees; anything else is taken from the first."""
    a = trees[0]
    if isinstance(a, dict): return {k: avg_tree([t[k] for t in trees]) if all(k in t for t in trees) else a[k] for k in a}
    if isinstance(a, list) and a and all(isinstance(x, (int, float)) for x in a[:16]) and not isinstance(a[0], bool):
        arr = np.mean([np.asarray(t, dtype=np.float64) for t in trees], axis=0)
        return [float(round(x, 7)) for x in arr]
    if isinstance(a, list) and a and isinstance(a[0], list): return [avg_tree([t[i] for t in trees]) for i in range(len(a))]
    return a

# the policy
P = [load(n, "gpolicy") for n in names]
pol = dict(P[0]); pol["net"] = avg_tree([p["net"] for p in P]); pol["metrics"] = {"averaged": names}
json.dump(pol, open(os.path.join(here, f"{out}-gpolicy.json"), "w"))
# the value net: dequantise each layer, average, quantise back with a fresh scale an output
V = [load(n, "gvalue") for n in names]
layers = []
for li, L0 in enumerate(V[0]["layers"]):
    Ws = [np.frombuffer(base64.b64decode(v["layers"][li]["q"]), np.int8).reshape(v["layers"][li]["n"]).astype(np.float64) * np.asarray(v["layers"][li]["s"]) for v in V]
    W = np.mean(Ws, axis=0); s = np.abs(W).max(0) / 127; s[s == 0] = 1e-12
    q = np.clip(np.round(W / s), -127, 127).astype(np.int8)
    b = np.mean([np.asarray(v["layers"][li]["b"], dtype=np.float64) for v in V], axis=0) if L0["b"] else []
    layers.append({"n": L0["n"], "q": base64.b64encode(q.tobytes()).decode(), "s": [float(x) for x in s], "b": [float(x) for x in b]})
val = dict(V[0]); val["layers"] = layers; val["metrics"] = {"averaged": names}; val["note"] = f"weight average of {', '.join(names)}"
json.dump(val, open(os.path.join(here, f"{out}-gvalue.json"), "w"))
# the dealer
D = [load(n, "scryg") for n in names]
json.dump(avg_tree(D), open(os.path.join(here, f"{out}-scryg.json"), "w"))
print(f"{out}: the average of {', '.join(names)}")
