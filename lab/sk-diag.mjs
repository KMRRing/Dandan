// Schafkopf's bidding diagnostics (Fable, 25 Nov 2026 01:36Z). Read-only.
//  decl <self-play batch>: the declarer's real payoff by contract, mean ± SE (does a solo still pay in self-play?)
//  over <match batch> <reference batch> <sd>: where our seat played a Solo and Hard, in that seat on that deal, declared nothing,
//    the search's mean for the Solo at the bid (value units → tariffs at that job's SD) against the payoff it got at the Hard table;
//    and where Hard called a Sauspiel and our seat passed, the search's best Sauspiel mean and its pass mean against what Hard's
//    Sauspiel paid in that seat. The gap is the search's over- (or under-) estimate, in tariffs.
//  defend <match batch> <reference batch> (Fable 02:10Z, order 2): deals where a Codex Hard seat declares the same Solo or Wenz at
//    both tables (ours and the four-Hard reference) and our seat defends: our payoff against Hard's in that seat, by contract
// usage: node lab/sk-diag.mjs decl <batch[+re-run]> | over <batch[+re-run]> <reference batch[+re-run]> <sd> | defend <batch> <reference>
import { labStore } from "./lib.mjs";

const [mode, batch, refBatch, sdArg] = process.argv.slice(2), store = await labStore();
async function linesOf(ids) {
  const by = new Map();
  for (const id of ids.split("+")) for (const n of (await store.list(`results/${id}/`)).filter(n => /part-\d+\.jsonl$/.test(n))) {
    let t = ""; try { t = (await store.get(n)) || ""; } catch { continue; }
    for (const l of t.split("\n")) if (l.startsWith("{")) { const g = JSON.parse(l); by.set(g.seed, g); }
  }
  return [...by.values()];
}
const stat = xs => { const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / Math.max(1, n), sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, n - 1)); return { n, m, se: sd / Math.sqrt(Math.max(1, n)) }; };
const f = s => `${s.m >= 0 ? "+" : ""}${s.m.toFixed(2)} ± ${s.se.toFixed(2)} (${s.n})`;

if (mode === "decl") {
  const by = {};
  for (const g of await linesOf(batch)) if (g.contract) (by[g.contract.type] ||= []).push(g.payoff[g.contract.declarer]);
  console.log(`${batch}: the declarer's real payoff by contract, tariffs: ${Object.entries(by).map(([t, v]) => `${t} ${f(stat(v))}`).join("; ")}`);
} else if (mode === "over") {
  const sd = Number(sdArg), toT = u => (u - 0.5) * 2 * sd, A = await linesOf(batch), refs = new Map((await linesOf(refBatch)).map(l => [l.seed, l.ref]));
  const est = [], real = [], gap = [], sEst = [], pEst = [], sReal = [], ourPass = [];
  for (const l of A) {
    const ref = refs.get(l.seed); if (!ref) continue;
    for (const s of l.seats) {
      const bid = s.dec.find(d => d.opts.some(([k]) => JSON.parse(k).t === "pass"));   // our seat's bid (its options include passing)
      if (!bid) continue;
      const mean = k => { const o = bid.opts.find(([x]) => x === k); return o && o[1] != null ? toT(o[1]) : null; };
      const hardSaid = ref.contract && ref.contract.declarer === s.me ? ref.contract.type : "none";
      const chosen = JSON.parse(bid.opts[0][0]);
      if (s.contract?.type === "solo" && s.contract.declarer === s.me && hardSaid === "none" && chosen.type === "solo") {
        const e = toT(bid.opts[0][1]); est.push(e); real.push(s.payoff); gap.push(e - s.payoff);
      }
      if (hardSaid === "sau" && chosen.t === "pass") {
        const saus = bid.opts.filter(([x]) => JSON.parse(x).type === "sau" && JSON.parse(x).t === "play").map(([, m]) => toT(m));
        if (saus.length) { sEst.push(Math.max(...saus)); pEst.push(mean(bid.opts.find(([x]) => JSON.parse(x).t === "pass")[0])); sReal.push(ref.payoff[s.me]); ourPass.push(s.payoff); }
      }
    }
  }
  console.log(`${batch}: our Solo where Hard declared nothing in the seat: the search's mean at the bid ${f(stat(est))}, the payoff got ${f(stat(real))}, over-estimate ${f(stat(gap))}`);
  console.log(`  Hard's Sauspiel that we passed: the search's best Sauspiel mean ${f(stat(sEst))}, its pass mean ${f(stat(pEst))}; Hard's Sauspiel paid ${f(stat(sReal))} in the seat; our pass got ${f(stat(ourPass))}`);
}
else if (mode === "defend") {
  const A = await linesOf(batch), refs = new Map((await linesOf(refBatch)).map(l => [l.seed, l.ref])), by = {};
  for (const l of A) {
    const ref = refs.get(l.seed); if (!ref?.contract || ref.contract.type === "sau") continue;
    for (const s of l.seats) {
      const c = s.contract;
      if (!c || c.type !== ref.contract.type || c.declarer !== ref.contract.declarer || c.declarer === s.me) continue;
      (by[c.type] ||= []).push(s.payoff - ref.payoff[s.me]);
    }
  }
  console.log(`${batch}: our seat defending Hard's own ${Object.keys(by).join(" / ")} (same declarer and game at both tables), our payoff less Hard's in the seat: ${Object.entries(by).map(([t, v]) => `${t} ${f(stat(v))}`).join("; ")}`);
}
