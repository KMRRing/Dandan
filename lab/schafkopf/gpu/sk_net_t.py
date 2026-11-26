"""The lab's nets (lab/schafkopf/nets/*.json, as sk-net.js runs them) on a batch, on any device: a policy on the raw view, or
M1 (raw + the partner facts + the own and the public belief over who holds the called ace). Identical to sk-net.js to float
rounding (test_nets.py)."""
import json, torch
from sk_view_t import raw_view, partner_view, RAW_SIZE, PART_SIZE


class Net:
    def __init__(self, j, device="cpu"):
        self.kind, self.inputs, self.n_in = j["kind"], j["inputs"], j["n_in"]
        self.layers = [(torch.tensor(l["w"], dtype=torch.float32, device=device), torch.tensor(l["b"], dtype=torch.float32, device=device)) for l in j["layers"]]
        self.beliefs = {k: Net(v, device) for k, v in j["beliefs"].items()} if j.get("beliefs") else None
        self.mask = j.get("mask")

    def run(self, x):
        for i, (w, b) in enumerate(self.layers):
            x = x @ w.T + b
            if i < len(self.layers) - 1: x = torch.relu(x)
        return x

    def belief(self, raw, q, public):
        """Probabilities over the four relative seats holding the called ace, masked by the exact mask; zeros when it's empty."""
        x = torch.cat([raw, q], 1)
        if public: x = x.clone(); x[:, :32] = 0; x[:, RAW_SIZE + 4:RAW_SIZE + 8] = 0
        z = self.run(x)
        m = (q[:, 0:4] if public else q[:, 4:8]) > 0
        p = torch.softmax(z.masked_fill(~m, -1e9), 1)
        return p * m.any(1, keepdim=True)

    def inputs_of(self, D, seat):
        raw = raw_view(D, seat)
        if self.inputs == "raw": return raw
        if self.inputs != "raw+part": raise ValueError(f"inputs {self.inputs} not on the GPU yet")
        q = torch.round(255 * partner_view(D, seat)) / 255
        return torch.cat([raw, q, self.beliefs["own"].belief(raw, q, False), self.beliefs["public"].belief(raw, q, True)], 1)

    def forward(self, D, seat):
        return self.run(self.inputs_of(D, seat))


def load(path, device="cpu"):
    return Net(json.load(open(path)), device)
