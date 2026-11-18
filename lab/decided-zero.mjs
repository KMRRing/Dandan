// How much of Zero's self-play is spent after the game is decided (18 Nov 2026, Korbi 03:56: "when the engine is almost
// guaranteed to win or to lose it thinks a lot; in long locked-out games this costs a lot of compute and doesn't change the
// outcome"). From zero-play.mjs's decision lines (g, i, seat, v: the searched value of the move played, c: the options with n,
// the deals each was weighed in) and its game lines (winner): for each finished game, the decided stretch at threshold T (from
// the first decision after which every decision gives the eventual winner T or more), as a share of decisions and of search
// effort (deals summed over the options). And resigning (AlphaZero's way): a seat resigns after `run` of its own decisions in a
// row valued below 1 − T; how many games it would have resigned, how many of those it went on to win (false resignations).
// usage: node lab/decided-zero.mjs <zero-play job ids, comma-separated> [most games 2000]
import { labStore } from "./lib.mjs";

const [ids, most = 2000] = process.argv.slice(2);
const store = await labStore(), each = Number(most) / ids.split(",").length;
const games = [];
for (const id of ids.split(",")) {
  const start = games.length;
  for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) {
    if (games.length - start >= each) break;
    const dec = new Map();
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.c && o.g != null && o.i != null) { if (!dec.has(o.g)) dec.set(o.g, []); dec.get(o.g).push({ i: o.i, seat: o.seat, v: o.v, work: o.c.reduce((a, c) => a + (c.n || 0) + (c.dn || 0), 0) }); }
      else if (o.game != null && o.seed != null) games.push({ winner: o.winner, turns: o.turns, vs: !!o.vs, dec: (dec.get(o.seed) || []).sort((a, b) => a.i - b.i) });
    }
  }
}
const fin = games.filter(g => g.winner >= 0 && g.dec.length && !g.vs);
console.log(`${fin.length} finished self-play games (draws and rival games left out), ${fin.reduce((a, g) => a + g.dec.length, 0)} searched decisions`);
const totalWork = fin.reduce((a, g) => a + g.dec.reduce((b, d) => b + d.work, 0), 0), totalDec = fin.reduce((a, g) => a + g.dec.length, 0);
for (const T of [0.9, 0.95, 0.97, 0.99]) {
  let dec = 0, work = 0, decidedGames = 0;
  for (const g of fin) {
    const w = g.dec.map(d => (d.seat === g.winner ? d.v : 1 - d.v));
    let k = w.length;
    while (k > 0 && w[k - 1] >= T) k--;
    if (k < w.length) decidedGames++;
    for (let j = k; j < w.length; j++) { dec++; work += g.dec[j].work; }
  }
  console.log(`decided at ${T}: ${(100 * dec / totalDec).toFixed(1)}% of decisions, ${(100 * work / totalWork).toFixed(1)}% of the search's deals, in ${(100 * decidedGames / fin.length).toFixed(0)}% of games`);
}
console.log("resigning: a seat resigns after `run` of its own decisions in a row valued below the threshold");
for (const [thr, run] of [[0.02, 2], [0.03, 2], [0.05, 2], [0.05, 3], [0.1, 3]]) {
  let resigned = 0, wrong = 0, saved = 0, savedWork = 0;
  for (const g of fin) {
    const streak = [0, 0];
    for (let j = 0; j < g.dec.length; j++) {
      const d = g.dec[j];
      streak[d.seat] = d.v != null && d.v < thr ? streak[d.seat] + 1 : 0;
      if (streak[d.seat] >= run) {
        resigned++; if (d.seat === g.winner) wrong++;
        saved += g.dec.length - j - 1; for (let k = j + 1; k < g.dec.length; k++) savedWork += g.dec[k].work;
        break;
      }
    }
  }
  console.log(`below ${thr} for ${run}: resigns ${(100 * resigned / fin.length).toFixed(0)}% of games, ${resigned ? (100 * wrong / resigned).toFixed(1) : "0"}% of them wrongly (that seat won); saves ${(100 * saved / totalDec).toFixed(1)}% of decisions, ${(100 * savedWork / totalWork).toFixed(1)}% of the deals`);
}
