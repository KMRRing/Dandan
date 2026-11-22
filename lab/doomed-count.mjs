// How often a side casts Dandân while it controls no Island (so it is sacrificed at once), and how often a turn ends with a land
// in the active player's hand and none played (17 Nov 2026, Korbi: "Monte Zero playing Dandâns into no Islands"; Fable's count
// on Korbi's games: 21 of 195 Monte turns held a land). Zero's self-play games replayed exactly.
// usage: node lab/doomed-count.mjs <shard> <shards> <out> <zero-play jobs, comma-separated | file:<output>>
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";
import { DECK, islands, typesOf, isLandId, defOf } from "../dandan-core.js";

const islandCard = x => typesOf({ id: x }).includes("Island");

const [SH, SHS, OUT, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
// by side (22 Nov 2026, Fable: both engines in a match against live Monte): a rival game's rival seat counts under its nets
const WHY = [], DEC = new Map();
const real = Math.random, fresh = () => ({ games: 0, casts: 0, doomed: 0, doomedWithIslandInHand: 0, doomedLandUnplayed: 0, turns: 0, held: 0, heldIsland: 0, facedDoomed: 0, answeredDoomed: 0, fetchable: 0, fetchSurvived: 0, fetchDied: 0, fetchAnswered: 0, trulyDoomed: 0, trulySurvived: 0 });
const SIDES = new Map(), sideOf = (game, seat) => (game.vs ? (seat === game.vs.seat ? `rival ${game.vs.nets}` : "the batch's nets") : "self-play");
const side = (game, seat) => { const k = sideOf(game, seat); if (!SIDES.has(k)) SIDES.set(k, fresh()); return SIDES.get(k); };
function replay(game) {
  if (game.branch) return;   // branch games start mid-game from another (zero/branch-lib.mjs): left out here
  let G = recordOf(rules, game), watch = null; const track = [];   // watch: a doomed Dandân on the stack, { sid, by } (Fable 17:32Z: is it answered anyway?)
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = G.state;
    // the other seat's reply to a doomed Dandân while it is on the stack: a spell aimed at it, or anything else (counted once)
    if (watch && who !== watch.by) {
      if (!s.stack.some(x => x.sid === watch.sid)) watch = null;
      else {
        const T = side(game, who);
        T.facedDoomed++;
        if (m.t === "cast" && (m.targets || []).some(t => t.k === "s" && t.sid === watch.sid)) {
          T.answeredDoomed++;
          // why (Korbi 23:10: is it the policy, or injected randomness?): the game's one random move (explore3), whether the caster
          // could still get an Island before it resolves (an untapped land of its that fetches an Island: then it was not doomed),
          // and the search's own values for the answer and for passing, from the decision line
          const fetch = s.bf.some(p => p.ctl === watch.by && !p.tapped && (defOf(p.id).fetch || []).includes("Island"));
          const d = DEC.get(`${game.seed}:${i}`), key = x => JSON.stringify(x), val = c => c.d ?? c.q;
          const ans = d?.c?.find(c => key(c.mv) === key(m)), pass = d?.c?.find(c => c.mv?.t === "pass");
          WHY.push({ side: sideOf(game, who), card: DECK[m.card], random: game.explore3?.i === i, fetch, ans: ans ? val(ans) : null, pass: pass ? val(pass) : null });
        }
        watch = null;
      }
    }
    if (m.t === "cast" && DECK[m.card] === "Dandân") {
      const T = side(game, who);
      T.casts++;
      if (!islands(s, who).length) {   // an Island by its land types (Thundering Falls and Mystic Sanctuary are Islands; Mind Bend's changes read)
        T.doomed++;
        const islandInHand = s.hand[who].some(islandCard);
        if (islandInHand) T.doomedWithIslandInHand++;
        if (islandInHand && !s.played && s.active === who && /^main/.test(s.step)) T.doomedLandUnplayed++;
      }
    }
    Math.random = seeded(rngSeedOf(game, i));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = real;
    if (r.error) return;
    if (m.t === "cast" && DECK[m.card] === "Dandân" && !islands(s, who).length) { const top = r.G.state.stack[r.G.state.stack.length - 1]; if (top && top.ctl === who) watch = { sid: top.sid, by: who }; }
    // a Dandân cast with no Island (Korbi 23:36: does the caster then fetch an Island in time, when it is not answered?): with an
    // untapped land of its that fetches an Island it is "fetchable", else truly doomed; its fate once it leaves the stack
    if (m.t === "cast" && DECK[m.card] === "Dandân" && !islands(s, who).length) {
      const top = r.G.state.stack[r.G.state.stack.length - 1];
      if (top && top.ctl === who) {
        const fetch = s.bf.some(p => p.ctl === who && !p.tapped && (defOf(p.id).fetch || []).includes("Island"));
        track.push({ sid: top.sid, by: who, id: m.card, fetch, answered: false, side: side(game, who) });
        if (fetch) side(game, who).fetchable++; else side(game, who).trulyDoomed++;
      }
    }
    for (const t of track) if (!t.done && who !== t.by && m.t === "cast" && (m.targets || []).some(x => x.k === "s" && x.sid === t.sid)) t.answered = true;
    for (const t of track) if (!t.done && !r.G.state.stack.some(x => x.sid === t.sid)) {
      t.done = true;
      const alive = r.G.state.bf.some(p => p.id === t.id && p.ctl === t.by);
      if (t.fetch) { if (t.answered) t.side.fetchAnswered++; else if (alive) t.side.fetchSurvived++; else t.side.fetchDied++; }
      else if (alive) t.side.trulySurvived++;
    }
    if (r.G.state.turn !== s.turn) {
      const a = s.active, T = side(game, a), lands = s.hand[a].filter(isLandId);
      T.turns++;
      if (!s.played && lands.length) { T.held++; if (lands.some(islandCard)) T.heldIsland++; }
    }
    G = r.G;
  }
  for (const T of new Set([side(game, 0), side(game, 1)])) T.games++;
}
const local = ids.startsWith("file:");
const store = local ? null : await (await import("./lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % SHS === SH);
for (const name of parts) for (const line of ((local ? fs.readFileSync(name, "utf8") : await store.get(name)) || "").split("\n")) {
  if (!line || line.startsWith('{"v":1')) continue;
  if (line.startsWith('{"g"')) { const d = JSON.parse(line); delete d.x; DEC.set(`${d.g}:${d.i}`, d); continue; }
  const o = JSON.parse(line);
  if (o.game != null && o.moves) replay(o);
}
const pc = (a, b) => `${a} of ${b} (${(100 * a / Math.max(1, b)).toFixed(1)}%)`;
for (const w of WHY) console.log(`answered doomed Dandân: ${w.side} with ${w.card}; the game's random move: ${w.random ? "yes" : "no"}; caster could fetch an Island: ${w.fetch ? "yes" : "no"}; search: answer ${w.ans == null ? "-" : (100 * w.ans).toFixed(1)}, pass ${w.pass == null ? "-" : (100 * w.pass).toFixed(1)}`);
for (const [k, T] of SIDES) console.log(`${k}: Dandân cast with no Island: truly doomed ${T.trulyDoomed} (survived anyway ${T.trulySurvived}); with an untapped land that fetches an Island ${T.fetchable}: not answered and survived ${T.fetchSurvived}, not answered and died ${T.fetchDied}, answered ${T.fetchAnswered}`);
for (const [k, T] of SIDES) console.log(`${k}: facing the other seat's doomed Dandân on the stack ${T.facedDoomed} times, answered it with a spell aimed at it ${pc(T.answeredDoomed, T.facedDoomed)}`);
for (const [k, T] of SIDES) console.log(`${k}: ${T.games} games: Dandân cast with no Island of its own ${pc(T.doomed, T.casts)} of casts; of those, an Island in hand ${T.doomedWithIslandInHand}, and its land drop unused in its own main phase ${T.doomedLandUnplayed}. Turns ending with a land in hand and none played: ${pc(T.held, T.turns)} (an Island among them ${T.heldIsland})`);
if (OUT && OUT !== "-") fs.writeFileSync(OUT, JSON.stringify(Object.fromEntries(SIDES)) + "\n");
