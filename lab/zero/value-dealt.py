"""The value net as the search uses it (19 Nov 2026, Fable): on the held-out value rows, its chance of winning on the true position
(pt.f32, both hands face up, as the scorecard scores it) beside its mean over worlds dealt from the seat's own belief (pd.f32: the
hidden hand dealt as the search deals it), each against the game's result: log loss, Brier, favourite right.
usage: python3 lab/zero/value-dealt.py <packed v folder> (packed with DEALT=<n> VNET=<value net>, VBLEND=0, HOLD_ONLY=1)"""
import os, sys
import numpy as np
d = sys.argv[1]
rd = lambda n: np.fromfile(os.path.join(d, n), np.float32)
if not os.path.exists(os.path.join(d, "pd.f32")): sys.exit("value-dealt: no pd.f32 in the pack (DEALT not set)")
y, h = rd("won.f32"), np.fromfile(os.path.join(d, "hold.u8"), np.uint8) > 0
# the library race (19 Nov 2026, Fable): the same on the rows with 10 cards or fewer left in the library, where branch games
# should help if they help at all
LIB = np.fromfile(os.path.join(d, "lib.u8"), np.uint8) if os.path.exists(os.path.join(d, "lib.u8")) else None
sets = [("", h)] + ([(" (library <= 10)", h & (LIB <= 10))] if LIB is not None else [])
for (tag, m), (name, f) in [(a, b) for a in sets for b in (("true hands", "pt.f32"), ("dealt hands", "pd.f32"))]:
    p = np.clip(rd(f)[m], 1e-6, 1 - 1e-6); t = y[m]
    if not len(t): continue
    name = name + tag
    print(f"value on {name}: rows {len(t)}, log loss {float(-(t * np.log(p) + (1 - t) * np.log(1 - p)).mean()):.4f}, Brier {float(((p - t) ** 2).mean()):.4f}, favourite right {float(((p > 0.5) == (t > 0.5)).mean()):.4f}")

# The value net's resolution by level (19 Nov 2026, Fable): held-out rows bucketed by the net's own prediction (5 points); inside
# each bucket, does a higher prediction still mean more wins? The slope of the result on the prediction (least squares, with its
# standard error): near 1, the net's differences at that level are real at face value; near 0, they are noise there. Positions
# of one game are not independent, so the errors are optimistic.
def buckets(name, f):
    p, t = rd(f)[h], y[h]
    print(f"resolution by level, {name}: bucket | rows | mean prediction | wins | slope ± se")
    for lo in range(0, 100, 5):
        m = (p >= lo / 100) & (p < (lo + 5) / 100 if lo < 95 else p <= 1)
        n = int(m.sum())
        if n < 200: continue
        x, r = p[m] - p[m].mean(), t[m]
        sxx = float((x * x).sum()); b = float((x * (r - r.mean())).sum() / sxx) if sxx > 0 else 0.0
        res = r - r.mean() - b * x; se = float(np.sqrt((res * res).sum() / max(1, n - 2) / sxx)) if sxx > 0 else float("inf")
        print(f"  {lo:>2}-{lo + 5:<3}% | {n:>6} | {100 * p[m].mean():5.1f} | {100 * r.mean():5.1f} | {b:5.2f} ± {se:.2f}")
for name, f in (("true hands", "pt.f32"), ("dealt hands", "pd.f32")): buckets(name, f)
