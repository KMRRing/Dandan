// The bid ladder (13 Nov 2026, Korbi: "build it up from the bottom, cheapest first"): what we pay is each class's market price,
// so rank the classes by market price per vCPU and fill the cheapest rung first. A rung opens only when every pool on the
// rungs below it is full (won = desired), or when it costs at most twice the cheapest rung (OPEN_WITHIN: the cheapest alone can
// sit unfilled for hours behind the account's limits). A pool on a closed rung that has won nothing is held back (deleted), so
// the account's machine limit goes to the cheap machines. Pools winning on closed rungs keep their machines until the open rungs
// have won as many vCPUs, the dearest cut first. Advice only: the changes are made through Rackspace.
// usage: node lab/ladder.mjs <snapshot.json> [out market.json]
//   snapshot: { t, classes: [{ name, cpu, market, minBid }], pools: [{ id, cls, kind: "k8s"|"vm", bid, desired, won }] }
import fs from "node:fs";

const [inFile, outFile] = process.argv.slice(2);
const snap = JSON.parse(fs.readFileSync(inFile, "utf8"));
const cls = new Map(snap.classes.map(c => [c.name, { ...c, perCore: c.market / c.cpu }]));
const WHERE = { hkg: "Hong Kong", syd: "Sydney", lon: "London", iad: "US East", iad2: "US East 2", dfw: "Dallas", dfw2: "Dallas 2", ord: "Chicago", sjc: "San Jose" };
const whereOf = name => WHERE[name.split("-").pop()] || name.split("-").pop();
// rungs: distinct prices per vCPU, cheapest first (to a tenth of a millicent, so equal prices share a rung)
const key = x => Math.round(x * 1e7) / 1e7;
const pools = snap.pools.map(p => ({ ...p, perCore: cls.get(p.cls)?.perCore ?? Infinity, cpu: cls.get(p.cls)?.cpu ?? 0, where: whereOf(p.cls) }));
const rungs = [...new Set(pools.map(p => key(p.perCore)))].sort((a, b) => a - b);
const OPEN_WITHIN = 2;
let full = true;
const out = [];
for (const [i, r] of rungs.entries()) {
  const here = pools.filter(p => key(p.perCore) === r), open = full || r <= OPEN_WITHIN * rungs[0];
  for (const p of here) out.push({ rung: i + 1, perCore: r, coreMonth: +(r * 730).toFixed(3), cls: p.cls, where: p.where, kind: p.kind, bid: p.bid, desired: p.desired, won: p.won || 0, cpu: p.cpu, open,
    action: open ? (p.bid < (cls.get(p.cls)?.market ?? 0) ? "raise bid to the market" : "bid") : p.won ? "keep until replaced" : "hold back: delete" });
  if (here.some(p => (p.won || 0) < p.desired)) full = false;
}
// the open rungs' vCPUs replace the closed rungs' winners, dearest first
let cheap = out.filter(l => l.open).reduce((a, l) => a + l.won * l.cpu, 0);
for (const l of out.filter(l => !l.open && l.won).sort((a, b) => b.perCore - a.perCore)) if (cheap >= l.won * l.cpu) { cheap -= l.won * l.cpu; l.action = "cut: replaced by cheaper vCPUs"; }
const won = pools.reduce((a, p) => a + (p.won || 0), 0), cores = pools.reduce((a, p) => a + (p.won || 0) * p.cpu, 0);
const hr = pools.reduce((a, p) => a + (p.won || 0) * (cls.get(p.cls)?.market ?? 0), 0);
// the Fleet page's market tile reads t (ms), best (where, cores, coreMonth, ours) and note
const best = out.map(l => ({ cls: l.cls, where: l.where, cores: l.cpu, price: cls.get(l.cls).market, coreMonth: l.coreMonth, won: l.won, ours: `rung ${l.rung}, ${l.won}/${l.desired}, ${l.action.split(":")[0]}` }));
const note = `Ladder: cheapest $/vCPU first; rungs up to ${OPEN_WITHIN}× the cheapest bid, dearer ones held back; winners on dear rungs kept until cheaper vCPUs replace them.`;
const market = { t: Date.parse(snap.t), best, note, machines: won, cores, hr: +hr.toFixed(4), month: Math.round(hr * 730), perCoreNow: cores ? +(hr / cores).toFixed(5) : null, ladder: out };
console.log(JSON.stringify({ machines: won, cores, hr: market.hr, month: market.month, rungs: rungs.length }));
for (const l of out) console.log(`${String(l.rung).padStart(2)}  $${l.perCore.toFixed(5)}/vCPU-h  ${l.cls.padEnd(20)} ${l.where.padEnd(10)} ${l.kind.padEnd(3)} bid ${l.bid} ${l.won}/${l.desired}  ${l.action}`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(market));
