"""
Trains the learned policy (dandan-netpolicy.js) to copy Medium, from lab/policy-data.mjs's lines: for each decision, a
score for every legal move from the position and the move's marks, and the loss is how unlikely the network finds
Medium's choice among them (a softmax over the decision's moves, cross-entropy). Games are split, not decisions: every
fifth game is held out, and the agreement printed is on those games only.

usage: python lab/policy/train.py OUT.json DATA.jsonl [DATA2.jsonl ...]   (writes the weights as dandan-netpolicy.js reads them)
"""
import json, sys, time, random
import torch
import torch.nn as nn

STATE_N, MOVE_N, H1, H2 = None, 80, 64, 32


def load(paths):
    rows = []
    for p in paths:
        with open(p) as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


class Net(nn.Module):
    def __init__(self, n_state):
        super().__init__()
        self.s = nn.Linear(n_state, H1)               # the position's part of the first layer (with its bias)
        self.m = nn.Linear(MOVE_N, H1, bias=False)    # a move's part
        self.l2 = nn.Linear(H1, H2)
        self.l3 = nn.Linear(H2, 1, bias=False)        # a bias would be the same for every move

    def forward(self, x, mv):
        # x: [B, n_state]; mv: [B, K, MOVE_N] (padding rows all zero, masked out by the caller)
        h = torch.relu(self.s(x).unsqueeze(1) + self.m(mv))
        return self.l3(torch.relu(self.l2(h))).squeeze(-1)


def batches(rows, n_state, bs, shuffle):
    idx = list(range(len(rows)))
    if shuffle: random.shuffle(idx)
    for a in range(0, len(idx), bs):
        part = [rows[i] for i in idx[a:a + bs]]
        K = max(len(r["m"]) for r in part)
        x = torch.tensor([r["x"] for r in part], dtype=torch.float32)
        mv = torch.zeros(len(part), K, MOVE_N)
        mask = torch.zeros(len(part), K, dtype=torch.bool)
        for b, r in enumerate(part):
            for k, marks in enumerate(r["m"]):
                mv[b, k, marks] = 1
                mask[b, k] = True
        y = torch.tensor([r["y"] for r in part])
        yield x, mv, mask, y


def agreement(net, rows, n_state):
    net.eval(); right = n = 0; loss = 0.0
    with torch.no_grad():
        for x, mv, mask, y in batches(rows, n_state, 2048, False):
            sc = net(x, mv).masked_fill(~mask, -1e9)
            loss += nn.functional.cross_entropy(sc, y, reduction="sum").item()
            right += (sc.argmax(1) == y).sum().item(); n += len(y)
    net.train()
    return right / n, loss / n


def main():
    out, paths = sys.argv[1], sys.argv[2:]
    random.seed(1); torch.manual_seed(1)
    rows = load(paths)
    n_state = len(rows[0]["x"])
    held = [r for r in rows if r["g"] % 5 == 0]
    train = [r for r in rows if r["g"] % 5 != 0]
    print(json.dumps({"decisions": len(rows), "train": len(train), "held out": len(held), "state": n_state}))
    net = Net(n_state)
    opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-5)
    base = sum(r["y"] == 0 for r in held) / len(held)
    print(json.dumps({"always pass agrees": round(base, 3)}))
    t0 = time.time()
    for epoch in range(12):
        for x, mv, mask, y in batches(train, n_state, 512, True):
            sc = net(x, mv).masked_fill(~mask, -1e9)
            loss = nn.functional.cross_entropy(sc, y)
            opt.zero_grad(); loss.backward(); opt.step()
        if epoch == 7:
            for g in opt.param_groups: g["lr"] = 5e-4
        acc, l = agreement(net, held, n_state)
        print(json.dumps({"epoch": epoch + 1, "held-out agreement": round(acc, 4), "loss": round(l, 4), "seconds": round(time.time() - t0)}), flush=True)
    w = lambda t: [round(v, 6) for v in t.detach().reshape(-1).tolist()]
    json.dump({
        "s": w(net.s.weight.t()), "m": w(net.m.weight.t()), "b1": w(net.s.bias),
        "w2": w(net.l2.weight.t()), "b2": w(net.l2.bias), "w3": w(net.l3.weight.reshape(-1)),
        "trained": {"decisions": len(train), "agreement": round(acc, 4)},
    }, open(out, "w"))


if __name__ == "__main__":
    main()
