// A match between two builds of the computer player (A and B), each a snapshot directory of the page's modules. Every deal is
// played twice with the seats swapped, so a lucky deal cancels. The arena (rules, runner) is A's; only the players differ.
// LIBCUT=lo-hi (an environment variable): every game starts with the library cut to lo..hi cards (by the deal's number; the rest in exile),
// so the games are decided by the end of the library, which a whole game rarely reaches (6 November 2026).
// LIBCUT=mid<lo>-<hi>: every game starts from a late position instead (7 November 2026): Medium plays Medium from the deal until, at a
// main phase with nothing on the stack, each seat has 8 to 15 lands, 1 to 4 cards in hand and at most one Dandân (the table the
// games of Korbi and Dave were decided on), and the library is then cut to lo..hi cards (by the deal's number, random cards of it
// to exile); the same position for both seatings and for every run of the deal. The rows say what the position was.
// usage: node match.mjs <A dir> <B dir> <first pair> <pairs> <out.jsonl> [A budget "deals:ms"] [B budget]
import fs from "node:fs";
import path from "node:path";
import { J, hr } from "./lib.mjs";
const [dirA, dirB, from, pairs, out, bA, bB] = [path.resolve(process.argv[2]), path.resolve(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), process.argv[6], process.argv[7], process.argv[8]];
// "deals", "deals:ms" or "deals:ms:first" (the deals before the first look; ms may be empty); none: the build's own deepest
const budgetOf = (spec, DEPTH) => {
  if (!spec) return DEPTH.deepest;
  const [d, ms, first] = spec.split(":");
  return { deals: Number(d), ms: Number(ms || 1e9), ...(first ? { first: Number(first) } : {}) };
};
async function player(dir, spec) {
  const th = await import(`${dir}/dandan-think.js`), budget = budgetOf(spec, th.DEPTH);
  // as the page does it: the worker's thinkMove at every decision (a stop at the upkeep included), not botMove's quick pass there
  return { budget, move: (s, seat) => th.thinkMove(s, seat, budget) };
}
const { rules } = await import(`${dirA}/dandan-rules.js`), { newRecord, applyMove, seeded, mix } = await import(`${dirA}/seats.js`);
const A = await player(dirA, bA), B = await player(dirB, bB);
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map(l => { const r = JSON.parse(l); return r.pair * 2 + r.aSeat; }) : []);
const realRandom = Math.random;
const MID = /^mid(\d+)-(\d+)$/.exec(process.env.LIBCUT || "");
const CUT = process.env.LIBCUT && !MID ? process.env.LIBCUT.split("-").map(Number) : null;
const core = await import(`${dirA}/dandan-core.js`), { DECK } = await import(`${dirA}/dandan-cards.js`), { policyMove } = await import(`${dirA}/dandan-policy.js`);
/** The late position of deal p: [state, what it was like] (games played on with Medium until one fits, up to a few tries, then the nearest). */
function midPosition(p) {
  const [lo, hi] = [Number(MID[1]), Number(MID[2])], L = lo + (p % (hi - lo + 1));
  const fits = (s, strict) => [0, 1].every(x => {
    const lands = s.bf.filter(q => q.ctl === x && core.isLand(q)).length, dd = s.bf.filter(q => q.ctl === x && DECK[q.id] === "Dandân").length, h = s.hand[x].length;
    return lands >= 8 && (!strict || (lands <= 15 && h >= 1 && h <= 4 && dd <= 1));
  });
  let best = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const seed = 5000 + p + attempt * 100003;
    let G = newRecord(rules, { seats: 2, seed, now: 0 });
    for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
      const who = rules.toMove(G.state), s = rules.restore(J(G.state));
      if (!s.pending && !s.stack.length && s.step === "main1" && s.lib.length >= L && fits(s, attempt < 11)) { best = { G, attempt, seed }; break; }
      Math.random = seeded(mix(seed, i + 1));
      G = applyMove(rules, G, who, policyMove(s, who, { rng: Math.random }), 0).G;
    }
    Math.random = realRandom;
    if (best) break;
  }
  if (!best) return null;
  const { G } = best, s = G.state, rnd = seeded(mix(5000 + p, 77));
  const gone = new Set();
  while (s.lib.length - gone.size > L) gone.add(Math.floor(rnd() * s.lib.length));
  const cut = s.lib.filter((_, i) => gone.has(i)), keep = new Set(s.lib.filter((_, i) => !gone.has(i)));
  s.lib = s.lib.filter((_, i) => !gone.has(i)); s.exile.push(...cut);
  s.kn = s.kn.filter(([id]) => keep.has(id));
  // where Commit // Memory is decides these races, and by now Medium has used it: a third of the deals leave it, a third put a copy
  // back in the library (a random place), a third in a hand (seat by the deal) -- from the graveyard or exile if one is there
  const mode = p % 3, spare = DECK.map((n, id) => id).find(id => DECK[id] === "Commit // Memory" && (s.yard.includes(id) || s.exile.includes(id)));
  if (mode && spare != null) {
    s.yard = s.yard.filter(id => id !== spare); s.exile = s.exile.filter(id => id !== spare);
    if (mode === 1) s.lib.splice(Math.floor(rnd() * (s.lib.length + 1)), 0, spare); else s.hand[(p >> 1) & 1].push(spare);
  }
  const at = id => { const w = s.lib.includes(id) ? "library" : s.hand[0].includes(id) ? "hand0" : s.hand[1].includes(id) ? "hand1" : s.yard.includes(id) ? "graveyard" : s.exile.includes(id) ? "exile" : "table"; return w; };
  const commits = DECK.map((n, id) => (n === "Commit // Memory" ? at(id) : null)).filter(Boolean).sort().join("+");
  return { G, info: { lib: s.lib.length, turn: s.turn, attempt: best.attempt, forced: mode && spare != null ? ['', 'library', 'hand'][mode] : '', commit: commits, lands: [0, 1].map(x => s.bf.filter(q => q.ctl === x && core.isLand(q)).length), hand: s.hand.map(h => h.length), dandans: [0, 1].map(x => s.bf.filter(q => q.ctl === x && DECK[q.id] === "Dandân").length) } };
}
for (let p = from; p < from + pairs; p++) for (const aSeat of [0, 1]) {
  if (done.has(p * 2 + aSeat)) continue;
  let G = newRecord(rules, { seats: 2, seed: 5000 + p, now: 0 }), t = [0, 0], n = [0, 0], moves = 0, info = null;
  if (MID) { const m = midPosition(p); if (!m) continue; G = J(m.G); info = m.info; }
  if (CUT) G.state.exile.push(...G.state.lib.splice(CUT[0] + (p % (CUT[1] - CUT[0] + 1))));
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state)), isA = who === aSeat, pl = isA ? A : B;
    Math.random = seeded(mix(5000 + p, i + 1));                       // the quick policy's own dice: the same in every run of this game
    const t0 = hr(), move = pl.move(s, who), dt = hr() - t0;
    t[isA ? 0 : 1] += dt; if (dt > 1) n[isA ? 0 : 1]++;
    G = applyMove(rules, G, who, move, 0).G; moves++;
  }
  Math.random = realRandom;
  const st = G.state;
  fs.appendFileSync(out, JSON.stringify({ pair: p, aSeat, winner: st.winner, aWon: st.winner === aSeat ? 1 : st.winner < 0 ? 0.5 : 0, why: st.why, turns: st.turn, life: st.life, lib: st.lib.length, ...(info ? { start: info } : {}), moves, msA: t[0], msB: t[1], nA: n[0], nB: n[1] }) + "\n");
}
