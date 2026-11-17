// Where in the search the answers are found (17 Nov 2026, Korbi: "is there a way to check where in the search tree the valuable
// answers are found (and under what conditions) and then optimize depth/breadth"; then "do all 3"). Zero's own games replayed,
// one searched decision in `every`, and at each the reference search (the loop's: 256 deals, deeper=0.03) and its variants on
// the same position, the same deals (the same seeds):
//   cut=<k>    the play-outs stop k moves past the tree and the value net weighs the position there (0: no play-out at all)
//   mass=<p>   the tree opens the fewest top moves holding p of the policy's probability (the loop's 0.9)
//   most=<n>   at most n of them (the loop's 6)
//   deals=<n>  n deals at most (the loop's 256)
//   nodeeper   no second look on close calls
//   seed=<n>   the reference itself on other deals (its salt): how often two runs of the same search agree, the noise floor
//   early=<at>:<gap>[:<most>]  stop at `at` deals when the leader is `gap` (win chance) ahead of the next move (with fewer
//              than `most` options only, when given)
// Variants combine with "+": cut=4+deals=128. For each decision: the reference's pick and its means for every move, each variant's
// pick and time, and the reference's trace (the move leading at every power of two of deals: when the answer settles).
// usage: node lab/zero/search-shape.mjs <jobs, comma-separated | file:<zero-play output>> <shard> <shards> <nets> <every> <variant>... > part.jsonl
//        node lab/zero/search-shape.mjs --sum part.jsonl...        (the table)
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { zeroOptions, generalBrain } from "./zero-lib.mjs";

const key = m => JSON.stringify(m), J = x => JSON.parse(JSON.stringify(x)), real = Math.random;

if (process.argv[2] === "--sum") {
  const rows = process.argv.slice(3).flatMap(f => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse));
  if (!rows.length) { console.log("no decisions"); process.exit(0); }
  const names = Object.keys(rows[0].v);
  const pct = x => (100 * x).toFixed(1).padStart(6) + "%";
  console.log(`${rows.length} decisions from ${new Set(rows.map(r => r.g)).size} games; the reference: ${(rows.reduce((a, r) => a + r.ref.ms, 0) / rows.length / 1000).toFixed(2)} s a decision`);
  console.log("loss: the reference's mean for its own pick less its mean for the variant's (win chance, points); time: the variant's over the reference's");
  const table = (label, sel) => {
    const R = rows.filter(sel);
    if (!R.length) return;
    console.log(`\n${label} (${R.length} decisions)`);
    console.log("variant".padEnd(26) + "  agrees   loss (pts)  loss>2pts    time");
    for (const n of names) {
      let same = 0, loss = 0, big = 0, t = 0, rt = 0;
      for (const r of R) {
        const v = r.v[n], refBest = r.ref.means[r.ref.best], mine = r.ref.means[v.best] ?? refBest;
        if (v.best === r.ref.best) same++;
        const l = Math.max(0, refBest - mine) * 100; loss += l; if (l > 2) big++;
        t += v.ms; rt += r.ref.ms;
      }
      console.log(n.padEnd(26) + pct(same / R.length) + (loss / R.length).toFixed(2).padStart(10) + pct(big / R.length).padStart(12) + (t / rt).toFixed(2).padStart(9) + "×");
    }
  };
  table("all decisions", () => true);
  table("2 options", r => r.n === 2);
  table("3-5 options", r => r.n >= 3 && r.n <= 5);
  table("6+ options", r => r.n >= 6);
  table("turns 1-6", r => r.turn <= 6);
  table("turns 7-14", r => r.turn > 6 && r.turn <= 14);
  table("turns 15+", r => r.turn > 14);
  table("a question (not priority)", r => r.q);
  table("close (the reference's best two within 3 pts)", r => r.gap < 0.03);
  table("clear (more than 10 pts apart)", r => r.gap > 0.1);
  // when the answer settles: the share of decisions whose final pick already led at d deals (the reference's trace)
  console.log("\nwhen the answer settles: the share of decisions where the reference's final pick already led after d deals");
  const ds = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  console.log("".padEnd(26) + ds.map(d => String(d).padStart(7)).join(""));
  const settle = (label, sel) => {
    const R = rows.filter(sel);
    if (!R.length) return;
    console.log(label.padEnd(26) + ds.map(d => { const S = R.filter(r => r.ref.trace.some(t => t.d === d)); return S.length ? pct(S.filter(r => r.ref.trace.find(t => t.d === d).lead === r.ref.best).length / S.length) : "      -"; }).join(""));
  };
  settle("all", () => true);
  settle("2 options", r => r.n === 2);
  settle("3-5 options", r => r.n >= 3 && r.n <= 5);
  settle("6+ options", r => r.n >= 6);
  settle("close (<3 pts)", r => r.gap < 0.03);
  settle("clear (>10 pts)", r => r.gap > 0.1);
  process.exit(0);
}

const [ids, SH, SHS, NETS, EVERY] = process.argv.slice(2, 7), VARIANTS = process.argv.slice(7);
const LOOP = { deals: 256, deeper: { gap: 0.03 } };
const parse = (spec, base = LOOP) => {
  const o = { ...base, extra: { ...(base.extra || {}) } };
  for (const part of spec.split("+")) {
    const [k, v] = part.split("=");
    if (k === "cut") o.extra.cut = Number(v);
    else if (k === "mass") o.mass = Number(v);
    else if (k === "most") o.most = Number(v);
    else if (k === "deals") o.deals = Number(v);
    else if (k === "turns") o.extra.turns = Number(v);
    else if (k === "deepmax") o.deeper = { ...(o.deeper || { gap: 0.03 }), max: Number(v) };
    else if (k === "loop") {}
    else if (k === "nodeeper") o.deeper = null;
    else if (k === "seed") o.extra.salt = Number(v);   // the reference again on other deals: the noise floor
    else if (k === "early") { const [at, gap, most] = v.split(":").map(Number); o.extra.early = { at, gap, ...(most ? { most } : {}) }; }
    else throw new Error(`unknown variant part ${part}`);
  }
  return o;
};
// SHAPE_REF: the referee in place of the loop's search (a stronger one, to judge whether more search helps: e.g.
// deals=1024+deepmax=4); SHAPE_HARD: only the decisions the loop's search finds hard (its best two within 3 pts, or 6+ options),
// the loop's search then run first to find them
const REF = process.env.SHAPE_REF ? parse(process.env.SHAPE_REF) : LOOP, HARD = !!process.env.SHAPE_HARD;
const specs = VARIANTS.map(v => [v, parse(v)]);
const brain = await generalBrain(NETS);
const local = ids.startsWith("file:");
const store = local ? null : await (await import("../lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(o => /\/part-\d+\.jsonl$/.test(o)).sort().filter((_, k) => k % Number(SHS) === Number(SH));
const text = async p => (local ? fs.readFileSync(p, "utf8") : await store.get(p)) || "";

function search(s, seat, o, seed, i, trace = null) {
  const focus = o.mass != null || o.most != null ? (c, w) => brain.player.focus(c, w, o.mass ?? 0.9, o.most ?? 6) : brain.player.focus;
  Math.random = seeded(mix(seed, 777 + i));
  const t0 = Date.now(), r = brain.think(s, seat, o.deals, { ...(o.deeper ? { deeper: o.deeper } : {}), focus, ...o.extra, ...(trace ? { trace } : {}) });
  return { r, ms: Date.now() - t0 };
}

// SHAPE_MAX: the most decisions this shard weighs (the workflow's budget)
const MAX = Number(process.env.SHAPE_MAX) || Infinity;
let done = 0;
outer: for (const p of parts) {
  for (const game of (await text(p)).split("\n").filter(Boolean).map(JSON.parse).filter(o => o.game != null && o.moves)) {
    const seed = game.seed;
    let G = newRecord(rules, { seats: 2, seed, now: 0 });
    brain.reset();
    for (let i = 0; i < game.moves.length; i++) {
      const [who, m] = game.moves[i], s = rules.restore(J(G.state));
      if (zeroOptions(s, who).length > 1 && seeded(mix(seed, 4242 + i))() < 1 / Number(EVERY)) {
        let hard = true;
        if (HARD) { const l = search(s, who, LOOP, seed, i).r, ms = l.list.map(c => c.mean).sort((a, b) => b - a); hard = !l.only && (ms[0] - (ms[1] ?? ms[0]) < 0.03 || l.list.length >= 6); }
        const trace = [], ref = hard ? search(s, who, REF, seed, i, trace) : null;
        if (ref && !ref.r.only) {
          const means = Object.fromEntries(ref.r.list.map(c => [key(c.move), c.mean])), sorted = ref.r.list.map(c => c.mean).sort((a, b) => b - a);
          const v = {};
          for (const [name, o] of specs) { const x = search(s, who, o, seed, i); v[name] = { best: key(x.r.best), ms: x.ms }; }
          console.log(JSON.stringify({ g: seed, i, turn: s.turn, n: ref.r.list.length, q: !!s.pending, gap: sorted[0] - (sorted[1] ?? sorted[0]),
            ref: { best: key(ref.r.best), means, ms: ref.ms, trace: trace.map(t => ({ d: t.d, lead: t.lead, alive: t.alive })) }, v }));
          if (++done >= MAX) break outer;
        }
      }
      Math.random = seeded(mix(seed, i + 1));
      const r = applyMove(rules, G, who, m, 0);
      Math.random = real;
      if (r.error) break;
      brain.seen(s, who, m, r.G.state);
      G = r.G;
    }
  }
}
