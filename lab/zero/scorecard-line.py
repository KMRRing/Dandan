"""One net's scorecard line from policy_np.py's and value_np.py's logs (18 Nov 2026, .github/workflows/net-scorecard.yml)."""
import json, re, sys

name, pol, val = sys.argv[1:4]
p = None
for line in open(pol):
    m = re.search(r"best epoch \d+: (\{.*\})", line)
    if m: p = json.loads(m.group(1))
v = next((l for l in open(val) if "scorecard:" in l), "")
num = lambda k: re.search(rf"{k} ([0-9.]+)", v).group(1) if re.search(rf"{k} ([0-9.]+)", v) else "-"
bk = p["byKind"] if p else {}
pct = lambda x: f"{100 * x:.1f}%"
print(f"\n### {name}\n")
print("| policy: agrees with the search | pass | land | cast | soft loss | points given up | value: log loss | Brier | favourite right | rows |")
print("|---|---|---|---|---|---|---|---|---|---|")
if p:
    print(f"| {pct(p['modelAgrees'])} ({p['decisions']} decisions) | {pct(bk['pass']['modelAgrees'])} | {pct(bk['land']['modelAgrees'])} | {pct(bk['cast']['modelAgrees'])} | "
          f"{p.get('softLoss', '-')} | {p['modelGivesUp']} | {num('log loss')} | {num('Brier')} | {num('favourite right')} | {num('rows')} |")
