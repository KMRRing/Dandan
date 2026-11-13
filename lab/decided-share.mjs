// How much of self-play is spent after the game is decided (13 Nov 2026, Fable): in each game, the decisions after the
// search's value of the eventual winner's position passed 97% for good (every searched decision from there on, by either
// seat, gives the winner 97% or more), as a share of all decisions and of the searched ones. Drawn games are left out.
// usage: node lab/decided-share.mjs <self-play job ids, comma-separated> [threshold 0.97] [most games 3000]
import { labStore } from "./lib.mjs";

const [ids, thr = 0.97, most = 3000] = process.argv.slice(2);
const T = Number(thr);
let games = 0, moves = 0, searched = 0, afterMoves = 0, afterSearched = 0;
const hist = new Array(10).fill(0);
// one part file at a time, each job's in turn, until enough games (a whole job's files at once ran out of memory)
const store = await labStore(), each = Number(most) / ids.split(",").length;
for (const id of ids.split(",")) { const start = games; for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) { if (games - start >= each) break; for (const line of ((await store.get(name)) || "").split("\n")) {
  if (!line || games - start >= each) continue;
  const g = JSON.parse(line);
  if (!(g.winner >= 0) || !g.dec?.length) continue;
  // the winner's chance at each searched decision, by the value of the move played
  const vals = g.dec.filter(d => d.pick >= 0 && Number.isFinite(d.list?.[d.pick]?.[2])).map(d => ({ i: d.i, v: d.seat === g.winner ? d.list[d.pick][2] : 1 - d.list[d.pick][2] }));
  if (!vals.length) continue;
  let k = vals.length;
  while (k > 0 && vals[k - 1].v >= T) k--;
  const from = k < vals.length ? vals[k].i : Infinity;   // the first move of the decided stretch
  games++; moves += g.moves.length; searched += vals.length;
  afterMoves += g.moves.filter((_, i) => i >= from).length; afterSearched += vals.length - k;
  hist[Math.min(9, Math.floor((10 * (vals.length - k)) / vals.length))]++;
} } }
console.log(JSON.stringify({ ids, threshold: T, games, moves, searched, shareOfMoves: +(afterMoves / moves).toFixed(4), shareOfSearched: +(afterSearched / searched).toFixed(4),
  gamesByDecidedTenth: hist }));
