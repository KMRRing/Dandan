// A kept game (games/<started>.json on the game-records branch) played again move by move, with a seat's decisions weighed
// again by the current look-ahead: at each decision of the seat (Monte, seat 1, by default; 0 is the human) that had more
// than one move worth weighing, the move it made against what the look-ahead now makes of it and of the others, in the same
// deals. Printed: each move that came out `gap` or more behind the search's choice (or all of them with `all` 1, inside the
// turns fromTurn..toTurn), and a last line "JSON {...}" with every decision (the move's gap to the search's choice, and to
// the move with the highest mean: the choice stays on Medium's own move unless another clearly beats it, so the two differ).
// A move the search dropped early (a "*") has its mean from fewer deals, so its gap is biased. The old decision was made by an
// older build at 2,048 deals; this is a second opinion at `deals`, not a verdict. CURVE=1 also prints the end-of-game chart.
// usage: node lab/review.mjs <game.json> [deals 256] [seat 1] [gap 0.03] [fromTurn 0] [toTurn 999] [all 0|1]
import fs from "node:fs";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think } from "../dandan-think.js";
import { moveName } from "../dandan-words.js";
import { curveOf } from "../dandan-advantage.js";

const a = process.argv, file = a[2];
const deals = Number(a[3] || 256), seat = Number(a[4] ?? 1), gap = Number(a[5] || 0.03), t0 = Number(a[6] || 0), t1 = Number(a[7] || 999), all = a[8] === "1";
const rec = JSON.parse(fs.readFileSync(file, "utf8")), g = rec.game, moves = (() => { try { return JSON.parse(g.moves); } catch { return null; } })();
if (!moves?.length || moves.length !== g.n) { console.log("this game does not carry all its moves; nothing to replay"); process.exit(0); }
let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
const key = m => JSON.stringify(m);
const out = { file, winner: rec.result?.winner, turns: rec.result?.turns, seat, weighed: 0, behind: [] };
for (let i = 0; i < moves.length; i++) {
  const [who, move] = moves[i], s = shownRules.restore(JSON.parse(JSON.stringify(G.state)));
  if (who === seat && s.turn >= t0 && s.turn <= t1 && !["mull", "bottom", "name"].includes(s.pending?.t)) {
    const res = think(s, seat, { deals, ms: 1e9 });
    if (!res.only) {
      out.weighed++;
      const mine = res.list.find(c => key(c.move) === key(move)), best = res.list[0], top = [...res.list].filter(c => !c.out).sort((x, y) => y.mean - x.mean)[0];
      const line = c => `${moveName(c.move, s, seat)} ${(100 * c.mean).toFixed(1)}%${c.out ? "*" : ""}`;
      const ctx = `move ${i} turn ${s.turn} ${s.step}${s.stack.length ? " (stack " + s.stack.map(x => x.name).join(",") + ")" : ""}; life ${s.life.join("/")}, hands ${s.hand.map(h => h.length).join("/")}, lib ${s.lib.length}`;
      const diff = mine ? best.mean - mine.mean : null;
      if (all || (mine && best !== mine && diff >= gap)) {
        console.log(`${ctx}: played ${mine ? line(mine) + " (n " + mine.n + ")" : moveName(move, s, seat) + " [not weighed]"}; best ${line(best)}${diff != null && best !== mine ? " gap " + (100 * diff).toFixed(1) : ""}${top !== best ? "; HIGHEST MEAN " + line(top) : ""}${mine && top !== mine ? " (top-over-played " + (100 * (top.mean - mine.mean)).toFixed(1) + ")" : ""}`);
        console.log("    others: " + res.list.slice(0, 5).map(line).join("; "));
      }
      if (mine && best !== mine && diff >= gap) out.behind.push({ i, turn: s.turn, step: s.step, played: line(mine), best: line(best), gap: +(100 * diff).toFixed(1), lib: s.lib.length });
      out.dec = out.dec || []; out.dec.push({ i, turn: s.turn, step: s.step, stack: s.stack.length, lib: s.lib.length, played: mine ? line(mine) : null, chosen: line(best), top: line(top), gapChosen: mine ? +(100 * (best.mean - mine.mean)).toFixed(1) : null, gapTop: mine ? +(100 * (top.mean - mine.mean)).toFixed(1) : null, playedOut: mine ? !!mine.out : null, kind: move.t });
      if (!mine) out.notWeighed = (out.notWeighed || 0) + 1;
    }
  }
  const r = applyMove(shownRules, G, who, move, g.started);
  if (r.error) { console.log("replay stopped at", i, r.error); break; }
  G = r.G;
}
if (process.env.CURVE) { const c = curveOf(rec.game.state, 0); console.log("CURVE (seat 0 = Korbi, chart incl. deckedChance): " + c.points.filter(p => p.turn >= t0 && p.turn <= t1).map(p => `${p.turn}${p.kind ? "a" : "s"}${p.by ?? ""}:${p.you}`).join(" ")); }
console.log("JSON " + JSON.stringify(out));
