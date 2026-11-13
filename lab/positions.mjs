// Positions of kept games looked at closely (13 Nov, the planning chat: Dave's game and the error-review markers): for each
// <game key>:<move index>, the mover's hand and open mana, what was played, Medium's move and its scores, and for each judge
// its value of the position as it stands (static) and a search at the given depth weighing every legal move: the top moves
// with their means, standard errors and deals. One JSON line a position and judge.
// usage: node lab/positions.mjs <game:move,game:move…> <judges, comma-separated: a file in judges/ or @job#variant> [deals 2048]
import fs from "node:fs";
import { J, readParts } from "./lib.mjs";
import { think, candidates } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { Player, openMana } from "../dandan-policy.js";
import { perm } from "../dandan-core.js";
import { DECK } from "../dandan-cards.js";
import { seeded, mix } from "../seats.js";
import { keptGames, recordAt } from "./mine-lib.mjs";

const [list, judgesArg] = [process.argv[2], process.argv[3]], deals = Number(process.argv[4] || 2048);
async function judgeOf(t) {
  if (t.startsWith("@")) {
    const [job, v] = t.slice(1).split("#"), ls = (await readParts(job)).flatMap(x => x.split("\n").filter(Boolean)).map(l => JSON.parse(l));
    return makeJudge((v == null ? ls[0] : ls.find(l => l.variant === Number(v))).layers);
  }
  return makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${t}`, import.meta.url), "utf8")).layers);
}
const judges = [];
for (const t of judgesArg.split(",")) judges.push([t, await judgeOf(t)]);
const nm = id => DECK[id] ?? "token";
/** A move in words: what it does and to whom. */
function say(s, m) {
  if (!m) return null;
  const t = (m.targets || []).map(x => (x.k === "p" ? `player ${x.seat}` : x.sid != null ? `spell ${nm(s.stack.find(y => y.sid === x.sid)?.id ?? s.stack.find(y => y.sid === x.sid)?.card)}` : perm(s, x.id) ? `${perm(s, x.id).ctl}:${nm(perm(s, x.id).id)}` : x.k));
  return [m.t, m.card != null ? nm(m.card) : null, m.mode != null ? `mode ${m.mode}` : null, t.length ? `→ ${t.join(", ")}` : null, m.name, m.from === "yard" ? "(from graveyard)" : null].filter(Boolean).join(" ");
}
const kept = keptGames();
for (const at of list.split(",")) {
  const [key, i] = [at.split(":")[0], Number(at.split(":")[1])];
  const game = kept.find(g => g.src === `kept:${key}.json`);
  if (!game) { console.log(JSON.stringify({ at, missing: true })); continue; }
  const G = recordAt(game, i), [seat, played] = game.moves[i], st = G.state, s = game.R.restore(J(st));
  const P = new Player(s, seat), scored = s.pending ? [] : P.scored().slice(0, 8).map(({ m, v }) => ({ move: say(st, m), v: +v.toFixed(3) }));
  const base = { at, turn: st.turn, step: st.step, seat, life: st.life, library: st.lib.length, hand: st.hand[seat].map(nm), theirHand: st.hand[1 - seat].length,
    openMana: openMana(s, seat), stack: st.stack.map(x => nm(x.id ?? x.card)), played: say(st, played), medium: say(st, candidates(s, seat, {})[0]), mediumScores: scored };
  for (const [name, judge] of judges) {
    const t0 = Date.now();
    Math.random = seeded(mix(game.opts.seed, 9000001 + i));
    const r = think(game.R.restore(J(st)), seat, { deals, ms: 1e9, all: true, offCheck: true, judge });
    console.log(JSON.stringify({ ...base, judge: name, static: +judge(game.R.restore(J(st)), seat).toFixed(4), seconds: Math.round((Date.now() - t0) / 1000), best: say(st, r.best), off: r.off,
      top: (r.list || []).slice(0, 6).map(c => ({ move: say(st, c.move), mean: +c.mean.toFixed(4), se: +c.se.toFixed(4), n: c.n, out: !!c.out })) }));
  }
}
