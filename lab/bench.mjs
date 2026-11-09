// Speed and sameness of the computer player. Plays fixed-seed games (Medium against Medium, Hard against Medium) and prints
// how long they took and a fingerprint of every move made, so an optimisation of the engine, the policy or the look-ahead can
// be checked to change nothing in what is played: the fingerprints before and after must be equal, only the seconds differ.
// usage: node lab/bench.mjs [medium games 20] [hard games 2] [hard deals 8] [dir .]
import path from "node:path";
import { J, hr } from "./lib.mjs";
const [mediumGames = 20, hardGames = 2, deals = 8, dir = "."] = process.argv.slice(2).map((x, i) => i === 3 ? x : Number(x));
const root = path.resolve(dir);
const { rules } = await import(`${root}/dandan-rules.js`), { newRecord, applyMove, seeded, mix } = await import(`${root}/seats.js`);
const pol = await import(`${root}/dandan-policy.js`), th = await import(`${root}/dandan-think.js`);
const medium = (s, seat) => pol.policyMove(s, seat, { rng: Math.random });
const hard = (s, seat) => th.thinkMove(s, seat, { deals, ms: 1e9 });

const realRandom = Math.random;
function play(seed, A, B, aSeat) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), moves = 0, h = 2166136261;
  const eat = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state)), pl = who === aSeat ? A : B;
    Math.random = seeded(mix(seed, i + 1));
    const move = pl(s, who);
    eat(JSON.stringify(move));
    G = applyMove(rules, G, who, move, 0).G; moves++;
  }
  Math.random = realRandom;
  const st = G.state;
  eat(`${st.winner}/${st.turn}/${st.life}/${st.lib.length}/${st.why}`);
  return { moves, hash: h };
}

const run = (name, n, A, B) => {
  const t0 = hr(); let moves = 0, hash = 0;
  for (let p = 0; p < n; p++) for (const aSeat of [0, 1]) { const r = play(9000 + p, A, B, aSeat); moves += r.moves; hash = (Math.imul(hash, 31) + r.hash) >>> 0; }
  const ms = hr() - t0;
  console.log(JSON.stringify({ name, games: n * 2, moves, seconds: +(ms / 1000).toFixed(2), msPerMove: +(ms / moves).toFixed(3), hash }));
};
if (mediumGames) run("medium-medium", mediumGames, medium, medium);
if (hardGames) run(`hard${deals}-medium`, hardGames, hard, medium);
