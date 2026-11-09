// How big is the end of the game to solve exactly? (9 November 2026: the measurement before any solver is built; it changes
// no behaviour.) From the kept games it takes positions at a seat's decision, cuts the shared library to L cards (6, 8, 10,
// 12) or takes a game's own late position as it was, and searches the game to its end with minimax (alpha-beta, a table of
// positions already seen) over the engine's own moves: each priority is passing or `moves()`, each question the answers
// `candidates()` lists. It counts what a solver would have to look at, not whether the answer is good.
//   open   = both hands as the record has them (the size of the search when nothing is hidden: the upper bound)
//   dealt  = the cards the mover can't see dealt again at random (`determinize`), as the solver would face them
// Cut positions are taken from turn 20 on with seven cards or fewer in the two hands together (a late game's size); late
// positions as they were (library 2 to 12, up to three a game) are marked `natural`.
// A shuffle (Flood Plain, Memory) is played with one fixed dice, so it is one branch, not many: the real tree is wider there.
// A position met again on the path being searched is scored a draw and counted (`loops`): Memory, Mystic Retrieval and bounce
// spells can go round. Values: 1 seat 0 wins, 0 seat 1 wins, 0.5 both lose or a loop.
// usage: node lab/endgame-count.mjs <games dir> <out.jsonl> [shard 0] [of 1] [node cap 2000000] [ms cap 30000]
import fs from "node:fs";
import path from "node:path";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded } from "../seats.js";
import { act, moves, toMove } from "../dandan-engine.js";
import { determinize, fork, candidates } from "../dandan-think.js";
import { DECK } from "../dandan-cards.js";
import { PASS } from "../dandan-policy.js";

const [dir, out, shard = 0, of = 1, NODES = 2e6, MS = 3e4] = [process.argv[2], process.argv[3], Number(process.argv[4] || 0), Number(process.argv[5] || 1), Number(process.argv[6] || 2e6), Number(process.argv[7] || 3e4)];
const LENGTHS = [6, 8, 10, 12], J = x => JSON.parse(JSON.stringify(x));
const nm = id => DECK[id] ?? "t" + id;

/** A position's name: cards by name (an Island is an Island), so two ways to the same table meet. */
function keyOf(s) {
  const bf = s.bf.map(p => `${nm(p.id)}${p.ctl}${p.tapped ? "t" : ""}${p.ent === s.turn ? "n" : ""}${p.tc ? JSON.stringify(p.tc) : ""}${p.pump ? JSON.stringify(p.pump) : ""}`).sort().join(",");
  return [s.active, s.step, s.prio, s.life, s.drawn, s.played, s.attacked ? 1 : 0, s.hand.map(h => h.map(nm).sort().join(",")).join("|"), bf,
    s.yard.map(nm).sort().join(","), s.lib.map(nm).join(","), JSON.stringify(s.stack.map(it => [nm(it.card ?? -1), it.name, it.ctl, it.targets, it.d])), JSON.stringify(s.pending), JSON.stringify(s.pool), JSON.stringify(s.combat)].join("#");
}
/** Every move the mover has here (priority: pass and `moves()`; a question: the answers the look-ahead lists). */
function choices(s, seat) {
  if (s.pending) return candidates(s, seat, { wide: 99 });
  return [PASS, ...moves(s, seat)];
}
const value = s => (s.winner === 0 ? 1 : s.winner === 1 ? 0 : 0.5);

class Capped extends Error {}
function solve(root) {
  const st = { nodes: 0, hits: 0, loops: 0, maxPly: 0, branches: 0, inner: 0, t0: Date.now() }, table = new Map(), path = new Set();
  const rec = (s, alpha, beta, ply) => {
    if (s.over) return value(s);
    const seat = toMove(s);
    if (seat == null) return 0.5;
    st.maxPly = Math.max(st.maxPly, ply);
    const k = keyOf(s);
    if (path.has(k)) { st.loops++; return 0.5; }
    const t = table.get(k);
    if (t) {
      if (t.lo >= beta) { st.hits++; return t.lo; }
      if (t.hi <= alpha) { st.hits++; return t.hi; }
      if (t.lo === t.hi) { st.hits++; return t.lo; }
      alpha = Math.max(alpha, t.lo); beta = Math.min(beta, t.hi);
    }
    if (++st.nodes > NODES || (st.nodes & 1023) === 0 && Date.now() - st.t0 > MS) throw new Capped();
    if (ply > 400) return 0.5;
    const list = choices(s, seat);
    st.inner++; st.branches += list.length;
    const a0 = alpha, b0 = beta;
    let best = seat === 0 ? -1 : 2;
    path.add(k);
    for (const m of list) {
      const c = fork(s), r = act(c, seat, m, { rng: seeded(7), quiet: true });
      if (typeof r === "string") continue;
      const v = rec(c, alpha, beta, ply + 1);
      if (seat === 0) { if (v > best) best = v; alpha = Math.max(alpha, v); } else { if (v < best) best = v; beta = Math.min(beta, v); }
      if (alpha >= beta) break;
    }
    path.delete(k);
    if (best === -1 || best === 2) best = 0.5;
    const e = table.get(k) || { lo: 0, hi: 1 };
    if (best <= a0) e.hi = Math.min(e.hi, best); else if (best >= b0) e.lo = Math.max(e.lo, best); else { e.lo = best; e.hi = best; }
    table.set(k, e);
    return best;
  };
  let value_ = null, capped = false;
  try { value_ = rec(root, -1, 2, 0); } catch (e) { if (!(e instanceof Capped)) throw e; capped = true; }
  return { value: value_, nodes: st.nodes, distinct: table.size, hits: st.hits, loops: st.loops, maxPly: st.maxPly, branch: st.inner ? +(st.branches / st.inner).toFixed(2) : 0, ms: Date.now() - st.t0, capped };
}

const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().filter((_, i) => i % of === shard);
for (const f of files) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).game;
  let moves_;
  try { moves_ = JSON.parse(g.moves || "[]"); } catch { continue; }
  if (!moves_.length || moves_.length !== g.n) continue;
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  const sampled = [];
  let late = 0, midSeen = 0;
  for (let i = 0; i < moves_.length; i++) {
    const [who, move] = moves_[i], s = shownRules.restore(J(G.state));
    if (!s.over && !s.pending && !s.stack.length && s.turn >= 10 && (s.step === "main1" || s.step === "upkeep") && toMove(s) === who && who === s.active) {
      if (s.lib.length <= 12 && late < 3 && s.lib.length >= 2) { late++; sampled.push({ i, s, natural: true }); }
      else if (s.lib.length > 12 && s.step === "main1" && s.turn >= 20 && s.hand[0].length + s.hand[1].length <= 7 && midSeen++ % 5 === 2 && sampled.filter(x => !x.natural).length < 4) sampled.push({ i, s, natural: false });
    }
    const r = applyMove(shownRules, G, who, move, g.started);
    if (r.error) break;
    G = r.G;
  }
  for (const { i, s, natural } of sampled) {
    for (const L of natural ? [s.lib.length] : LENGTHS) {
      const base = J(s);
      if (!natural) base.lib = base.lib.slice(0, L);
      const mover = toMove(base);
      for (const variant of ["open", "dealt"]) {
        const root = variant === "open" ? fork(base) : determinize(base, mover, seeded(1000 + i), false);
        const res = solve(root);
        fs.appendFileSync(out, JSON.stringify({ game: f.replace(".json", ""), move: i, turn: s.turn, natural, L, variant, mover, hands: base.hand.map(h => h.length), ...res }) + "\n");
      }
    }
  }
}
