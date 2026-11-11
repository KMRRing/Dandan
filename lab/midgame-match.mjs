// Squeeze against tempo from the middle of a game (Korbi, 11 November 2026): both sides on a fair amount of mana and not too many
// cards, one side ahead on mana and holding Memory Lapses, the rest of each setup varied (turn, who moves, lives, hands,
// graveyard). Each setup is played twice, squeeze the side ahead once and tempo once. One row a setup:
// { set, ahead: squeeze's score when it was ahead, behind: when tempo was, a: their mean }.
// usage: node lab/midgame-match.mjs <shard> <shards> <out> [switches for both, e.g. tiWeak=1 or -] [setups 1000] [dir .] [first seed 70000]
import fs from "node:fs";
import path from "node:path";
const [shard, shards, out, sw = "-", setups = 1000, dir = ".", first = 70000] = process.argv.slice(2).map((x, i) => [0, 1, 4, 6].includes(i) ? Number(x) : x);
const root = path.resolve(dir);
const { rules } = await import(`${root}/dandan-rules.js`), { applyMove, newRecord, seeded, mix, shuffle } = await import(`${root}/seats.js`);
const { policyMove, TUNE } = await import(`${root}/dandan-policy.js`), { scene } = await import(`${root}/tests/dandan-scene.js`);
const { DECK, CARDS } = await import(`${root}/dandan-cards.js`);
if (sw !== "-") for (const [k, v] of sw.split(",").map(kv => kv.split("="))) { if (!(k in TUNE)) throw new Error(`no switch ${k}`); TUNE[k] = Number(v); }
const J = x => JSON.parse(JSON.stringify(x));

const SPELLS = DECK.filter(n => CARDS[n.split(" // ")[0]]?.type !== "land" && !CARDS[n]?.subs?.includes("Island") && n !== "Island" && !/Plain|Depths|Boilerworks|Sandbar|Sanctuary|Isle|Falls/.test(n));
/** A setup: the side ahead (seat `up`) on two more lands and one or two Memory Lapses, the rest drawn from the deck. */
function setup(seed) {
  const r = seeded(seed), pick = (a, n) => shuffle([...a], r).slice(0, n), int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const up = int(0, 1), down = 1 - up, pool = [...SPELLS];
  const take = n => { const got = []; for (const x of pick(pool, n)) { pool.splice(pool.indexOf(x), 1); got.push(x); } return got; };
  const lapses = int(1, 2); for (let i = 0; i < lapses; i++) pool.splice(pool.indexOf("Memory Lapse"), 1);
  const hand = []; hand[up] = [...Array(lapses).fill("Memory Lapse"), ...take(int(2, 4) - lapses + 1)]; hand[down] = take(int(3, 5));
  for (const h of hand) if (r() < 0.6) h.push("Island");
  const lands = []; lands[down] = int(3, 4); lands[up] = lands[down] + 2;
  const bf = [0, 1].flatMap(seat => Array.from({ length: lands[seat] }, () => [seat, "Island"]));
  const yard = take(int(3, 8));
  const active = int(0, 1), life = [int(12, 20), int(12, 20)];
  const s = scene({ seed, active, step: "main1", turn: int(7, 10), hand, bf, yard, life });
  return { s, up };
}
const realRandom = Math.random;
function play(s0, styleOf, seed) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  G = { ...G, state: J(s0) };
  for (let i = 0; i < 3000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    const m = policyMove(s, who, { style: styleOf[who], rng: Math.random });
    Math.random = realRandom;
    const res = applyMove(rules, G, who, m, 0);
    if (res.error) throw new Error(res.error);
    G = res.G;
  }
  return G.state.winner;
}
for (let k = shard; k < setups; k += shards) {
  const seed = first + k, { s, up } = setup(seed), sc = [];
  for (const sqUp of [true, false]) {
    const sqSeat = sqUp ? up : 1 - up, styleOf = []; styleOf[sqSeat] = "squeeze"; styleOf[1 - sqSeat] = "tempo";
    const w = play(s, styleOf, seed);
    sc.push(w === sqSeat ? 1 : w == null || w < 0 ? 0.5 : 0);
  }
  fs.appendFileSync(out, JSON.stringify({ set: k, ahead: sc[0], behind: sc[1], a: (sc[0] + sc[1]) / 2 }) + "\n");
}
