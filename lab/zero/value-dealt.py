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
for name, f in (("true hands", "pt.f32"), ("dealt hands", "pd.f32")):
    p = np.clip(rd(f)[h], 1e-6, 1 - 1e-6); t = y[h]
    print(f"value on {name}: rows {len(t)}, log loss {float(-(t * np.log(p) + (1 - t) * np.log(1 - p)).mean()):.4f}, Brier {float(((p - t) ** 2).mean()):.4f}, favourite right {float(((p > 0.5) == (t > 0.5)).mean()):.4f}")
