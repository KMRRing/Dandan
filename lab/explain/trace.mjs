// A traced game for the lab's "How the AI works" page (16 Nov 2026, Korbi: "a walk through step by step, a short game where
// the player draws dead on lands and how the engine identifies and exploits that"). Monte Scry Zero as the live game plays it
// (judges/zero-g9x-C-*.json, the app's copies; makeZero as dandan-engines.js builds it; the close-call deeper look) in both
// seats, and at every decision the engine's insides written down: what each seat's Scry believes of the other hand (and the
// truth), what the policy net would pick on its own, what the search found for each option, and the value net's chance for
// both seats. Nothing here changes how a move is chosen: the trace reads the same nets the search reads.
// usage: node lab/explain/trace.mjs <seed> <deals> <out.json>
//        node lab/explain/trace.mjs screen <first seed> <count> <deals>   (short summary lines: who flooded, who won, turns)
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { makeZero, zeroOptions, qMarksOf, PASS } from "../../dandan-zero.js";
import { viewInto, marksOf, freeScorer, VIEW_N } from "../../dandan-netpolicy.js";
import { ext, EXT_N, NN, handCounts } from "../../dandan-zeroview.js";
import { NAMES, DECK, TOKEN_AT, CARDS, cardName } from "../../dandan-cards.js";
import { moveName } from "../../dandan-words.js";

const load = k => JSON.parse(fs.readFileSync(new URL(`../../judges/zero-g9x-C-${k}.json`, import.meta.url), "utf8").split("\n")[0]);
const NETS = { policy: load("policy"), qpolicy: load("qpolicy"), scry: load("scry"), value: load("value") };
const DEEPER = { deeper: { gap: 0.03 } };            // dandan-engines.js zero-g9x: the close-call look three turns ahead
const J = x => JSON.parse(JSON.stringify(x)), r3 = v => Math.round(v * 1000) / 1000;
const isLand = name => CARDS[name]?.type === "land";
const LAND_N = NAMES.map(isLand);

/** One game, traced. */
export function traceGame(seed, deals, { traceIt = true } = {}) {
  const brain = makeZero(NETS);
  const score = freeScorer(NETS.policy), qscore = freeScorer(NETS.qpolicy);
  const XB = new Float32Array(VIEW_N + EXT_N), EB = new Float32Array(EXT_N);
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  brain.reset();
  const steps = [], drawsBy = [[], []];
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    const ms = zeroOptions(s, who);
    let move, res = null;
    if (ms.length <= 1) move = ms[0] ?? PASS;
    else { res = brain.think(s, who, deals, DEEPER); move = res.best; }
    let step = null;
    if (traceIt) {
      step = { i, who, turn: s.turn, active: s.active, phase: s.step, q: s.pending?.t || null, move: moveName(move, s, who), m: move, board: boardOf(s) };
      // what each seat's Scry believes of the other hand, against the truth (both, so the page can show either side)
      const b = [0, 1].map(me => brain.scry(s, me, brain.tracker()));
      step.scry = b.map((x, me) => beliefOf(s, me, x));
      // the value net: each seat's chance (it reads both hands face up, as trained)
      step.value = [r3(brain.judge(s, 0)), r3(brain.judge(s, 1))];
      if (res) {
        // the policy net alone: its probability for each option, from what `who` sees and its own Scry of the other hand
        XB.set(viewInto(s, who), 0); XB.set(ext(s, who, b[who].counts, EB, null, b[who].any), VIEW_N);
        const sc = s.pending ? qscore(XB, ms.map(m => qMarksOf(s, who, m))) : score(XB, ms.map(m => marksOf(s, who, m)));
        const top = Math.max(...sc), e = sc.map(v => Math.exp(v - top)), z = e.reduce((a, c) => a + c, 0);
        const prior = new Map(ms.map((m, k) => [JSON.stringify(m), e[k] / z]));
        step.options = res.list.map(c => ({ move: moveName(c.move, s, who), mean: r3(c.mean), se: r3(c.se ?? 0), n: c.n, prior: r3(prior.get(JSON.stringify(c.move)) ?? 0), pick: JSON.stringify(c.move) === JSON.stringify(move) }));
        step.nOptions = ms.length;
      }
    }
    const before = s, r = applyMove(rules, G, who, move, 0);
    if (r.error) throw new Error(`seed ${seed} move ${i}: ${r.error}`);
    brain.seen(before, who, move, r.G.state);
    G = r.G;
    const after = G.state;
    if (traceIt) {
      step.log = (after.log || []).filter(l => l.n > (before.log?.length ? before.log[before.log.length - 1].n : -1)).map(l => l.t);
      steps.push(step);
    }
    // the cards each seat took from the library into its hand (the shared library: draws, Brainstorm, Chart a Course…)
    if (before.mull?.done?.[0] && before.mull?.done?.[1]) {
      const inLib = new Set(before.lib);
      for (const x of [0, 1]) for (const id of after.hand[x]) if (inLib.has(id) && !before.hand[x].includes(id)) drawsBy[x].push(cardName(id));
    }
  }
  const st = G.state;
  return { seed, deals, winner: st.winner, turns: st.turn, drawsBy, steps };
}

function beliefOf(s, me, b) {
  const opp = 1 - me, truth = handCounts(s, opp), out = { hand: s.hand[opp].length, unknown: b.unknown, names: {} };
  for (let n = 0; n < NN; n++) if (b.counts[n] > 0.02 || truth[n] > 0) out.names[NAMES[n]] = { exp: r3(b.counts[n]), any: r3(b.any[n]), real: truth[n] };
  // the lands in their hand: the expected number and the chance of none, from the slots (each its own distribution)
  let lands = 0, noLand = 1;
  for (const p of b.slots) { let pl = 0; for (let n = 0; n < NN; n++) if (LAND_N[n]) pl += p[n]; lands += pl; noLand *= 1 - pl; }
  for (let n = 0; n < NN; n++) if (LAND_N[n]) lands += b.known[n];
  // what the pool alone says (every unseen card equally likely): the yardstick Scry is read against
  let unseen = 0, unseenLand = 0;
  for (let n = 0; n < NN; n++) { unseen += b.unseen[n]; if (LAND_N[n]) unseenLand += b.unseen[n]; }
  let known = 0;
  for (let n = 0; n < NN; n++) if (LAND_N[n]) known += b.known[n];
  out.lands = r3(lands); out.noLand = r3(noLand); out.knownLands = known;
  // luck alone: the known lands, and the unknown cards at the unseen pool's share of lands
  out.poolLands = r3(known + (unseen ? (b.unknown * unseenLand) / unseen : 0));
  out.realLands = s.hand[opp].reduce((a, id) => a + (id < TOKEN_AT && isLand(DECK[id]) ? 1 : 0), 0);
  return out;
}

function boardOf(s) {
  const side = x => ({
    life: s.life[x], hand: s.hand[x].map(cardName), lib: s.lib.length,
    lands: s.bf.filter(p => p.ctl === x && p.id < TOKEN_AT && isLand(DECK[p.id])).map(p => (p.tapped ? "*" : "") + cardName(p.id)),
    other: s.bf.filter(p => p.ctl === x && !(p.id < TOKEN_AT && isLand(DECK[p.id]))).map(p => (p.tapped ? "*" : "") + cardName(p.id)),
    yard: s.yard.filter(id => (s.owner ? s.owner[id] === x : true)).length,
  });
  return { p: [side(0), side(1)], yard: s.yard.map(cardName), stack: s.stack.map(it => it.name || cardName(it.card)) };
}

if (process.argv[2] === "screen") {
  const [first, count, deals] = process.argv.slice(3).map(Number);
  for (let seed = first; seed < first + count; seed++) {
    const t = traceGame(seed, deals, { traceIt: false });
    const fl = t.drawsBy.map(d => `${d.filter(isLand).length}/${d.length}`);
    console.log(JSON.stringify({ seed, winner: t.winner, turns: t.turns, landsDrawn: fl, draws: t.drawsBy }));
  }
} else if (process.argv[2] === "rebelief") {
  // node lab/explain/trace.mjs rebelief <trace.json>: the beliefs written again by replaying the game's moves (no search), for a
  // trace made before a change to what is written of them
  const file = process.argv[3], t = JSON.parse(fs.readFileSync(file, "utf8")), brain = makeZero(NETS);
  let G = newRecord(rules, { seats: 2, seed: t.seed, now: 0 });
  brain.reset();
  for (const st of t.steps) {
    const s = rules.restore(J(G.state));
    st.scry = [0, 1].map(me => beliefOf(s, me, brain.scry(s, me, brain.tracker())));
    const r = applyMove(rules, G, st.who, st.m, 0);
    if (r.error) throw new Error(`step ${st.i}: ${r.error}`);
    brain.seen(s, st.who, st.m, r.G.state);
    G = r.G;
  }
  fs.writeFileSync(file, JSON.stringify(t));
  console.log(`${file}: beliefs rewritten for ${t.steps.length} decisions`);
} else if (process.argv[2] === "batch") {
  // node lab/explain/trace.mjs batch <deals> <dir> <seed> <seed>…: each game traced whole into <dir>/<seed>.json
  const [deals, dir, ...seeds] = process.argv.slice(3);
  for (const seed of seeds.map(Number)) {
    const t = traceGame(seed, Number(deals));
    fs.writeFileSync(`${dir}/${seed}.json`, JSON.stringify(t));
    console.log(JSON.stringify({ seed, winner: t.winner, turns: t.turns, draws: t.drawsBy }));
  }
} else if (process.argv[2]) {
  const [seed, deals, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
  const t0 = Date.now(), t = traceGame(seed, deals);
  fs.writeFileSync(out, JSON.stringify(t));
  console.log(`seed ${seed}: winner ${t.winner}, ${t.turns} turns, ${t.steps.length} decisions, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
