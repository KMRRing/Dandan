// The stopping rule of a match (lab/sequential.mjs): the normal quantile, the verdicts at the edges, and, by playing
// matches of made-up deals, what the rule does at a true 45%, 50%, 55% and 60%: that an equal candidate is adopted in
// no more than one match in twenty however many times it looks, that a 60% one nearly always is, and a 45% one is
// stopped early.
import { quantile, decide, dealScores } from "../lab/sequential.mjs";
import { seeded } from "../seats.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const near = (a, b, e) => Math.abs(a - b) < e;
/** n deals of which `w` score 1, `l` score 0 and the rest a half. */
const deals = (n, w, l) => [...Array(w).fill(1), ...Array(l).fill(0), ...Array(n - w - l).fill(0.5)];

check(near(quantile(0.975), 1.95996, 1e-4) && near(quantile(0.5), 0, 1e-9) && near(quantile(0.05), -1.64485, 1e-4) && near(quantile(0.0001), -3.71902, 1e-3),
  "the normal quantile");
const rows = (pair, a, b) => [{ pair, aSeat: 0, aWon: a }, { pair, aSeat: 1, aWon: b }];
check(dealScores([...rows(0, 1, 0.5), { pair: 1, aSeat: 0, aWon: 0 }]).join() === "0.25", "a deal scores 1 - the champion's mean once both seats have played it; a lone game scores nothing");
check(dealScores([...rows(0, 1, 1), ...rows(0, 1, 1)]).join() === "0", "a game played twice counts once");

check(decide(deals(29, 29, 0)).verdict === "continue" && decide(deals(29, 29, 0)).next === 1, "nothing is decided before 30 deals, however good the first 29");
check(decide(deals(30, 15, 0)).verdict === "adopt", "30 deals at 75% are adopted");
check(decide(deals(30, 0, 15)).verdict === "reject", "…and at 25% rejected");
const d48 = decide(deals(30, 9, 11));
check(d48.verdict === "continue" && d48.next === 30 && near(d48.mean, 0.467, 0.001), `${(100 * d48.mean).toFixed(0)}% after 30 deals goes on, for 30 more (it may still be 55%)`);
check(decide(deals(60, 18, 18)).next === 60 && decide(deals(120, 36, 36)).next === 120 && decide(deals(240, 72, 72)).next === 240, "each batch is as many deals as are played");
check(decide(deals(480, 130, 111)).verdict === "cap", "52% after 480 deals is undecided, not adopted");
check(decide(deals(480, 150, 100)).verdict === "adopt", "55% after 480 deals is adopted");
check(decide(deals(120, 25, 40)).verdict === "reject", "41% after 120 deals is rejected");

/** A match of made-up deals: each deal is two games the candidate wins with chance p; when and how the rule stops it. */
function match(p, rng) {
  const s = [];
  for (let n = 1; n <= 480; n++) {
    s.push(((rng() < p ? 1 : 0) + (rng() < p ? 1 : 0)) / 2);
    if ([30, 60, 120, 240, 480].includes(n)) { const r = decide(s); if (r.verdict !== "continue") return { verdict: r.verdict, n }; }
  }
  return { verdict: "cap", n: 480 };
}
const rates = (p, runs = 2000) => {
  const rng = seeded(1000 + Math.round(p * 100)), out = { adopt: 0, reject: 0, cap: 0, deals: 0 };
  for (let i = 0; i < runs; i++) { const r = match(p, rng); out[r.verdict]++; out.deals += r.n; }
  return { adopt: out.adopt / runs, reject: out.reject / runs, cap: out.cap / runs, deals: out.deals / runs };
};
const fmt = r => `adopted ${(100 * r.adopt).toFixed(1)}%, rejected ${(100 * r.reject).toFixed(1)}%, undecided ${(100 * r.cap).toFixed(1)}%, ${r.deals.toFixed(0)} deals on average`;
const R = Object.fromEntries([0.45, 0.5, 0.55, 0.6].map(p => [p, rates(p)]));
for (const p in R) console.log(`     true ${(100 * p).toFixed(0)}%: ${fmt(R[p])}`);
check(R[0.5].adopt <= 0.05, "an equal candidate is adopted in at most one match in twenty");
check(R[0.6].adopt >= 0.9, "a candidate at 60% is nearly always adopted");
check(R[0.45].reject >= 0.9 && R[0.45].deals < 150, "a candidate at 45% is nearly always rejected, early");

console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
