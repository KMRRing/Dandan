// The data of the lab's "How Monte thinks" page (howitworks.html): a traced game (trace.mjs), the same decisions weighed without
// Scry (without-scry.mjs) and the page's notes, in one smaller file the page reads. Every number on the page comes from here.
// usage: node lab/explain/pack.mjs <trace.json> <without-scry.json> <notes.json> <out.json>
// Game 3298 again from nothing (each step is deterministic; about 15 minutes on two cores):
//   node lab/explain/trace.mjs 3298 64 /tmp/t.json
//   node lab/explain/without-scry.mjs /tmp/t.json 256 lab/explain/without-scry-3298.json 85 104 136 138 141 162 188 189 197
//   node lab/explain/pack.mjs /tmp/t.json lab/explain/without-scry-3298.json lab/explain/notes-3298.json lab/explain/game-3298.json
import fs from "node:fs";

const [tf, wf, nf, out] = process.argv.slice(2);
const t = JSON.parse(fs.readFileSync(tf, "utf8")), ws = JSON.parse(fs.readFileSync(wf, "utf8")), notes = JSON.parse(fs.readFileSync(nf, "utf8"));
const belief = b => ({
  hand: b.hand, unknown: b.unknown, lands: b.lands, pool: b.poolLands, real: b.realLands,
  // the names worth showing: what Scry expects at least 5% of, and every card really there
  names: Object.entries(b.names).filter(([, v]) => v.exp >= 0.05 || v.real > 0).sort((a, c) => c[1].exp - a[1].exp).map(([n, v]) => [n, v.exp, v.any, v.real]),
});
const steps = t.steps.map(s => ({
  i: s.i, who: s.who, turn: s.turn, active: s.active, phase: s.phase, q: s.q, move: s.move, log: s.log,
  board: { p: s.board.p.map(p => ({ life: p.life, hand: p.hand, lands: p.lands, other: p.other })), lib: s.board.p[0].lib, stack: s.board.stack },
  value: s.value, scry: s.scry.map(belief),
  ...(s.options ? { options: s.options.slice(0, 6).map(o => [o.move, o.mean, o.prior, o.n, o.pick ? 1 : 0]), nOptions: s.nOptions } : {}),
}));
const data = { seed: t.seed, deals: t.deals, winner: t.winner, turns: t.turns, names: ["Cobalt", "Copper"], flooded: 1, ...notes, steps, withoutScry: ws };
fs.writeFileSync(out, JSON.stringify(data));
console.log(`${out}: ${steps.length} decisions, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
