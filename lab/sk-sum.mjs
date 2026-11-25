// Schafkopf's paired measure read (Fable, 24 Nov 2026 20:38Z, job 1): our seat's payoff less Codex Hard's in that seat on that deal,
// in tariffs: mean ± SE per seat-deal, by our role, the share of exact zeros (played as Hard did), our bidding against Hard's in the
// same seat on the same deal by contract, and the per-deal payoff's SD at the four-Hard tables (the value unit). With a second
// batch of the same deals (job 2), that batch less this one, paired by deal and seat. Read-only.
// usage: node lab/sk-sum.mjs <batch[+re-run]> [paired batch[+re-run]] [--ref <batch whose four-Hard tables to use>] [--dir <local folder of part-*.jsonl, for a test>]
import fs from "node:fs";

const args = process.argv.slice(2), at = args.indexOf("--dir"), dir = at >= 0 ? args.splice(at, 2)[1] : null;
const rat = args.indexOf("--ref"), refBatch = rat >= 0 ? args.splice(rat, 2)[1] : null, [batch, other] = args;
// a batch may be several jobs joined by "+" (a job and its re-run): each deal counted once, the later job's copy kept (a failed
// shard may have written some of its deals before it stopped)
async function linesOf(ids) {
  const by = new Map();
  for (const id of ids.split("+")) for (const l of await linesOfOne(id)) by.set(l.seed, l);
  return [...by.values()];
}
async function linesOfOne(id) {
  const out = [];
  const read = t => { for (const l of t.split("\n")) if (l.startsWith("{")) out.push(JSON.parse(l)); };
  if (dir) { for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"))) read(fs.readFileSync(`${dir}/${f}`, "utf8")); return out; }
  const { labStore } = await import("./lib.mjs"), store = await labStore();
  for (const n of (await store.list(`results/${id}/`)).filter(n => /part-\d+\.jsonl$/.test(n))) { try { read((await store.get(n)) || ""); } catch { /* a part being written */ } }
  return out;
}
const stat = xs => { const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / Math.max(1, n), sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, n - 1)); return { n, m, sd, se: sd / Math.sqrt(Math.max(1, n)) }; };
const f = (s, d = 3) => `${s.m >= 0 ? "+" : ""}${s.m.toFixed(d)} ± ${s.se.toFixed(d)} (${s.n})`;
const said = (c, seat) => (!c || c.declarer !== seat ? "none" : c.type);

let A = await linesOf(batch);
// --ref <batch> (a match played with noref=1): each deal's four-Hard table, and so each seat's difference, from that batch
if (refBatch) {
  const refs = new Map((await linesOf(refBatch)).map(l => [l.seed, l.ref]));
  A = A.filter(l => refs.has(l.seed)).map(l => { const ref = refs.get(l.seed); return { ...l, ref, seats: l.seats.map(s => ({ ...s, diff: +(s.payoff - ref.payoff[s.me]).toFixed(4) })) }; });
}
const hasRef = A.every(l => l.ref);   // a noref=1 match without --ref: only the pairing below can be read
const diffs = hasRef ? A.flatMap(l => l.seats.map(s => s.diff)) : [], all = stat(diffs);
console.log(`${batch}: ${A.length} paired deals${hasRef ? `, ${diffs.length} seat-deals` : " (no four-Hard tables: pass --ref to read it against Hard)"}`);
if (hasRef) {
console.log(`our seat less Codex Hard's, tariffs a deal: ${f(all)}; SD ${all.sd.toFixed(2)}; exact zeros ${(100 * diffs.filter(x => x === 0).length / Math.max(1, diffs.length)).toFixed(1)}%`);
const roles = {};
for (const l of A) for (const s of l.seats) (roles[s.role] ||= []).push(s.diff);
console.log(`by our role: ${Object.entries(roles).map(([r, v]) => `${r} ${f(stat(v), 2)}`).join("; ")}`);
const ref = stat(A.flatMap(l => l.ref.payoff));
console.log(`per-deal payoff SD at the four-Hard tables (the value unit): ${Math.sqrt(A.flatMap(l => l.ref.payoff).reduce((a, x) => a + x * x, 0) / Math.max(1, 4 * A.length - 1)).toFixed(3)} (mean ${ref.m.toFixed(3)}, ${ref.n} seat-deals)`);
// bidding: what Hard said in this seat at the reference table against what we said in it, and the mean difference in each cell
const K = ["none", "sau", "wenz", "solo"], cell = new Map();
for (const l of A) for (const s of l.seats) { const k = `${said(l.ref.contract, s.me)}>${said(s.contract, s.me)}`; (cell.get(k) || cell.set(k, []).get(k)).push(s.diff); }
console.log(`declaring, Hard's (rows) against ours (columns), seat-deals and mean difference:`);
console.log(`  ${"".padEnd(6)}${K.map(k => k.padStart(16)).join("")}`);
for (const r of K) console.log(`  ${r.padEnd(6)}${K.map(c => { const v = cell.get(`${r}>${c}`); return (v ? `${v.length} ${stat(v).m >= 0 ? "+" : ""}${stat(v).m.toFixed(2)}` : "-").padStart(16); }).join("")}`);
}
if (other) {
  const B = await linesOf(other), byA = new Map();
  for (const l of A) for (const s of l.seats) byA.set(`${l.seed}:${s.me}`, s.payoff);
  const d = [];
  for (const l of B) for (const s of l.seats) { const a = byA.get(`${l.seed}:${s.me}`); if (a != null) d.push(s.payoff - a); }
  const closes = B.flatMap(l => l.seats.flatMap(s => s.dec)), share = closes.filter(x => x.close).length / Math.max(1, closes.length);
  console.log(`${other} less ${batch}, paired by deal and seat: ${f(stat(d))}; close calls searched again: ${(100 * share).toFixed(1)}% of decisions`);
}
