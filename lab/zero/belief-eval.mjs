// Every belief net on the same frozen held-out cards (16 Nov 2026, Fable on 89d49477, ask 2): Zero's games replayed exactly, one
// position in six for each seat (the packers' own sampling, replay-pack.mjs and scry12-pack.mjs), held-out games only (every
// fifth seed, held out by every trainer), and at each position every card of the other hand `me` can't see scored by each belief:
// the error a card (nats) on the true name, each card alone and the whole hand dealt card after card (Scry 1 deals each card
// alone, so its two are the same), and the edge over the pool (the unseen cards' own odds, the only baseline that reads nothing
// a player can't see: Scry 1's Tracker fails tests/scry-honest.mjs).
// Beliefs: "pool"; "s1:<name>" Scry 1 (lab/zero/nets/<name>-scry.json, with the Tracker); "s12:<name>" Scry 1.2 (<name>-scry12.json);
// "old12:<module>:<name>" a Scry 1.2 net under an earlier scry12.mjs (the leaky g12s: that commit's file, copied in by the workflow).
// usage: node lab/zero/belief-eval.mjs <jobs, comma-separated | file:<zero-play output>> <shard> <shards> <belief>... > part.json
//        node lab/zero/belief-eval.mjs --sum part.json...        (the table)
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { DECK, NAMES } from "../../dandan-cards.js";
import { Tracker, scryOf, seenBy, unknownSlots } from "./zero-view.mjs";
import { Scry12 } from "./scry12.mjs";
import { netOf } from "./zero-lib.mjs";

const AT = new Map(NAMES.map((n, k) => [n, k])), EVERY = 6, J = x => JSON.parse(JSON.stringify(x)), real = Math.random;
const nats = p => -Math.log((p || 0) + 1e-9);

if (process.argv[2] === "--sum") {
  const tot = {};
  for (const f of process.argv.slice(3)) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(f, "utf8")))) {
    const t = (tot[k] ||= { each: 0, chain: 0, n: 0, games: 0 });
    t.each += v.each; t.chain += v.chain; t.n += v.n; t.games += v.games || 0;
  }
  const pool = tot.pool, per = t => [t.each / t.n, t.chain / t.n];
  const [pe] = per(pool);
  console.log(`${pool.n} held-out cards, ${pool.games} games; nats a card (lower is better), edge = the pool's ${pe.toFixed(4)} less the belief's`);
  console.log("belief".padEnd(28) + "each card  whole hand  edge each  edge whole");
  for (const [k, t] of Object.entries(tot)) {
    const [e, c] = per(t);
    console.log(k.padEnd(28) + e.toFixed(4).padStart(9) + c.toFixed(4).padStart(12) + (pe - e).toFixed(4).padStart(11) + (pe - c).toFixed(4).padStart(12));
  }
  process.exit(0);
}

const [ids, SH, SHS, ...specs] = process.argv.slice(2);
const old = new Map();
for (const sp of specs) if (sp.startsWith("old12:")) { const mod = sp.split(":")[1]; if (!old.has(mod)) old.set(mod, (await import(new URL(mod, import.meta.url))).Scry12); }
/** A belief's scorer for one game: update after each move, score(s, me, truth ids) → { each, chain }. */
function scorer(sp) {
  const [kind, a, b] = sp.split(":");
  if (kind === "pool") { const f = scryOf(null); return () => ({ update() {}, score(s, me, ids) { const p = f(s, me, null).slots; let e = 0; ids.forEach((id, j) => { e += nats(p[j][AT.get(DECK[id])]); }); return { each: e, chain: e }; } }); }
  if (kind === "s1") {
    const f = scryOf(netOf(`${a}-scry`));
    return T => ({ update() {}, score(s, me, ids) { const p = f(s, me, T).slots; let e = 0; ids.forEach((id, j) => { e += nats(p[j][AT.get(DECK[id])]); }); return { each: e, chain: e }; } });
  }
  const net = netOf(`${kind === "old12" ? b : a}-scry12`), Cls = kind === "old12" ? old.get(a) : Scry12;
  return () => { const F = [new Cls(0, net), new Cls(1, net)]; return { update(s, who, m, after) { for (const x of F) x.update(s, who, m, after); }, score(s, me, ids) { const r = F[me].score(s, ids); return { each: r.each, chain: r.chain }; } }; };
}
const makers = specs.map(scorer), out = Object.fromEntries(specs.map(k => [k, { each: 0, chain: 0, n: 0, games: 0 }]));
let broken = 0;

function replay(game) {
  const seed = game.seed;
  if (seed % 5 !== 0) return;
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  const T = new Tracker(), B = makers.map(f => f(T));
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = rules.restore(J(G.state));
    if (seeded(mix(seed, 31337 + i))() < 1 / EVERY) for (const me of [0, 1]) {
      if (seenBy(s, me).unknown <= 0) continue;
      const truth = unknownSlots(s, me);
      B.forEach((b, k) => { const r = b.score(s, me, truth), o = out[specs[k]]; o.each += r.each; o.chain += r.chain; o.n += truth.length; });
    }
    Math.random = seeded(mix(seed, i + 1));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = real;
    if (r.error) { broken++; return; }
    T.update(s, who, m, r.G.state);
    for (const b of B) b.update(s, who, m, r.G.state);
    G = r.G;
  }
  for (const k of specs) out[k].games++;
}

const local = ids.startsWith("file:");
const store = local ? null : await (await import("../lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(o => /\/part-\d+\.jsonl$/.test(o)).sort().filter((_, k) => k % Number(SHS) === Number(SH));
for (const name of parts) {
  const text = local ? fs.readFileSync(name, "utf8") : (await store.get(name)) || "";
  for (const line of text.split("\n")) if (line.startsWith('{"game"')) replay(JSON.parse(line));
}
if (broken) console.error(`belief-eval: ${broken} games not the same`);
console.log(JSON.stringify(out));
