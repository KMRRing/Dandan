// Branch games (19 Nov 2026, Korbi: "checking how and when games end, and then looking at the 'endings' that are less
// represented and doing branched games for these positions so they're weighted a bit heavier in the training data"; generalised
// so it carries to Modern). Nothing here knows Dandan: an ending is the rules' own reason a game ended (st.why) and how long it
// ran; a branch re-deals the hidden cards from the view of the player to move, consistent with everything public, and plays on.
//
// The re-deal (19 Nov 2026, Fable): both hands stay as they were; only the library places neither player knows are shuffled.
// A re-dealt hand would contradict its holder's recorded play (passing with two Islands up while "holding" the counter), and the
// dealer learns exactly that link; the unknown library order shaped nobody's past play, so any reshuffle of it is consistent
// with the whole history and still gives each branch its own future.
//
// Three kinds of branch point, from stored self-play games of the window:
//   E  an ending the generation under-represents: a few turns (2, 4 or 6) before that game's end
//   V  a roughly even position: the search read 40-60% for the player to move
//   B  both branches: a decision where another move was within 1.5 points of the one played; the branch plays that move first
//      (its own search is not written as a lesson: the move is forced)
// A branch game's record: { seed: its own, branch: { src, at, seat, kind, force? }, moves: the source's first `at` moves, then
// its own }. Moves before `at` replay with the source's randomness, the re-deal and every move after with the branch's own
// (rngSeedOf); the packer (replay-pack2.mjs) replays it the same way and writes lessons from `at` on only. Its hold-out follows
// the source (training seeds only are branched), so no held-out game leaks into training.
import { newRecord, seeded, mix } from "../../seats.js";
import { knOf } from "../../dandan-core.js";

const J = x => JSON.parse(JSON.stringify(x));

/** The ending's class: the rules' reason and the game's length in turns (a bucket). */
export const lengthBucket = t => (t <= 8 ? "≤8" : t <= 14 ? "9-14" : t <= 20 ? "15-20" : "21+");
export const endingOf = g => `${g.why || "?"}|${lengthBucket(g.turns || 0)}`;

/** Weights from a census { class: games }: the rarer an ending, the more its games are branched (inverse frequency against the
 *  median class, between 1 and `most`). Classes with fewer than `least` games are left at 1 (too few to say). */
export function weightsOf(census, { most = 8, least = 5 } = {}) {
  const n = Object.values(census).filter(c => c >= least).sort((a, b) => a - b), med = n.length ? n[Math.floor(n.length / 2)] : 1, w = {};
  // a conceded game's true ending is unknown (the concession cut it short): its class stays at 1
  for (const [k, c] of Object.entries(census)) w[k] = c < least || k.startsWith("resign|") ? 1 : Math.min(most, Math.max(1, med / c));
  return w;
}

/** The randomness of move i of a game: a branch game's moves before its branch point are the source's. */
export const rngSeedOf = (game, i) => (game.branch && i < game.branch.at ? mix(game.branch.src, i + 1) : mix(game.seed, i + 1));
/** The record a game starts from: a branch game's from its source's seed. */
export const recordOf = (rules, game) => newRecord(rules, { seats: 2, seed: game.branch ? game.branch.src : game.seed, now: 0 });
/** The re-deal at the branch point: the library places neither player knows, shuffled (`seat` is kept in the record only). */
export function redeal(rules, state, seat, seed) {
  const s = rules.restore(J(state)), rng = seeded(mix(seed, 991)), at = [];
  s.lib.forEach((id, i) => { if (!knOf(s, id)) at.push(i); });
  const ids = at.map(i => s.lib[i]);
  for (let k = ids.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [ids[k], ids[j]] = [ids[j], ids[k]]; }
  at.forEach((i, k) => { s.lib[i] = ids[k]; });
  return s;
}

/** Whether a game is one of the never-resign share (zero-play.mjs resign=<t>:<run>:<keep>: games with seeded(mix(seed, 777001)) under
 *  keep play out): their endings are the unbiased sample of how games really finish. */
export const neverResign = (g, keep = 0.1) => !g.vs && !g.branch && seeded(mix(g.seed, 777001))() < keep;

/** The branch points of a set of stored games (parsed game lines and decision lines, by seed), each with its weight. */
export function branchPoints(games, decisions, weights, { kinds = { E: 0.6, V: 0.2, B: 0.2 } } = {}) {
  const pts = [];
  for (const g of games) {
    if (g.seed % 5 === 0 || g.vs || g.branch) continue;   // training seeds, self-play, no branch of a branch
    const w = weights[endingOf(g)] || 1;
    for (const k of [2, 4, 6]) if ((g.turns || 0) > k + 2) pts.push({ kind: "E", g, turnAt: g.turns - k, w: kinds.E * w / 3 });
    const ds = (decisions.get(g.seed) || []).filter(d => !d.qd && d.c?.length >= 2 && d.v != null);
    const even = ds.filter(d => d.v >= 0.4 && d.v <= 0.6), close = [];
    for (const d of ds) {
      const val = c => c.d ?? c.q, top = val(d.c[d.pick]);
      for (const c of d.c) if (c !== d.c[d.pick] && top - val(c) <= 0.015) close.push({ d, c });
    }
    for (const d of even) pts.push({ kind: "V", g, at: d.i, w: kinds.V * w / even.length });
    for (const { d, c } of close) pts.push({ kind: "B", g, at: d.i, force: c.mv, w: kinds.B * w / close.length });
  }
  return pts;
}

/** One branch point, drawn by weight. */
export function drawPoint(pts, rng) {
  let t = rng() * pts.reduce((a, p) => a + p.w, 0);
  for (const p of pts) if ((t -= p.w) <= 0) return p;
  return pts[pts.length - 1];
}
