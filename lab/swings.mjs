// The judge against real games (10 November 2026, Korbi: "when the judge says a player has 10% and that player, without much
// luck, handily wins, the computer does not understand the game"). Every kept game (games/*.json of the game-records branch)
// played again; at the start of each turn, with nothing on the stack, the judge's chance for the human (seat 0), knowing both
// hands. Printed: per game the curve and its lowest and highest point; then, over all games, how often the judge's verdict
// came true, by how sure it was (a judge that knows the game wins about 15% of the positions it gives 15%).
// usage: node lab/swings.mjs <folder of games> [min turns left 3]
import fs from "node:fs";
import path from "node:path";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { winChance } from "../dandan-eval.js";

const dir = process.argv[2], minLeft = Number(process.argv[3] ?? 3);
const all = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), g = rec.game;
  let moves;
  try { moves = JSON.parse(g.moves); } catch { continue; }
  if (!moves?.length || moves.length !== g.n || rec.result?.drawn) continue;
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  const curve = [];
  let lastTurn = -1, ok = true;
  for (let i = 0; i < moves.length; i++) {
    const st = G.state;
    if (st.turn !== lastTurn && !st.stack.length && !st.pending && st.step !== "mull") {
      lastTurn = st.turn;
      curve.push({ turn: st.turn, active: st.active, lib: st.lib.length, p: winChance(shownRules.restore(JSON.parse(JSON.stringify(st))), 0), hands: [st.hand[0].length, st.hand[1].length], life: [...st.life] });
    }
    const r = applyMove(shownRules, G, moves[i][0], moves[i][1], g.started);
    if (r.error) { ok = false; break; }
    G = r.G;
  }
  if (!ok || !rules_over(G)) continue;
  const won = G.state.winner === 0 ? 1 : 0, turns = G.state.turn;
  for (const c of curve) all.push({ ...c, won, left: turns - c.turn, file: f, level: rec.result?.level, think: rec.result?.think });
  const lo = curve.reduce((a, c) => (c.p < a.p ? c : a), curve[0]), hi = curve.reduce((a, c) => (c.p > a.p ? c : a), curve[0]);
  console.log(`${f} ${rec.result?.level ?? "?"}/${rec.result?.think ?? "?"} ${won ? "human won " : "Monte won "} ${String(turns).padStart(2)} turns  lowest ${(100 * lo.p).toFixed(0).padStart(3)}% (turn ${lo.turn}, ${lo.lib} cards)  highest ${(100 * hi.p).toFixed(0).padStart(3)}% (turn ${hi.turn})  ${curve.map(c => Math.round(100 * c.p)).join(" ")}`);
}
function rules_over(G) { return shownRules.over(G.state); }

// the sawtooth: the judge's chance for the player whose turn it is against the average of the turns either side (a judge
// whose verdict only moves on news would show no lean to either side; each new turn also brings a card drawn, worth a little)
const lean = [];
for (let i = 1; i + 1 < all.length; i++) {
  const [a, b, c] = [all[i - 1], all[i], all[i + 1]];
  if (a.file !== b.file || c.file !== b.file) continue;
  const mine = x => (b.active === 0 ? x.p : 1 - x.p);
  lean.push(mine(b) - (mine(a) + mine(c)) / 2);
}
const ml = lean.reduce((x, y) => x + y, 0) / lean.length, sl = Math.sqrt(lean.reduce((x, y) => x + (y - ml) ** 2, 0) / (lean.length - 1) / lean.length);
console.log(`\nthe judge's chance for the player whose turn it is, against the turns either side: ${(100 * ml).toFixed(1)} ± ${(100 * sl).toFixed(1)} points (${lean.length} turns)`);
const rows = all.filter(r => r.left >= minLeft);
console.log(`\npositions with ${minLeft}+ turns left: ${rows.length} from ${new Set(rows.map(r => r.file)).size} games; the judge's chance for the human against how often the human won`);
for (const [lo, hi] of [[0, 0.1], [0.1, 0.2], [0.2, 0.35], [0.35, 0.5], [0.5, 0.65], [0.65, 0.8], [0.8, 0.9], [0.9, 1.01]]) {
  const b = rows.filter(r => r.p >= lo && r.p < hi);
  if (!b.length) continue;
  const games = new Set(b.map(r => r.file)).size, won = b.reduce((a, r) => a + r.won, 0) / b.length;
  console.log(`judge ${String(Math.round(lo * 100)).padStart(2)}-${String(Math.round(Math.min(hi, 1) * 100)).padEnd(3)}%  positions ${String(b.length).padStart(4)} (${String(games).padStart(2)} games)  human won ${(100 * won).toFixed(0)}%`);
}
