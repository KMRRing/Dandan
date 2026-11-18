// The latest nets' games against each rival, broken down by how they ended (18 Nov 2026: zl16 scored 32.7% against the
// full-effort g12r-C, after zl15's 50.5% against the shortcut version): won or lost, by resignation or played out, by seat,
// game length. Read-only.
// usage: node lab/rival-sum.mjs <zero-play job ids, comma-separated>
import { labStore } from "./lib.mjs";

const [ids] = process.argv.slice(2);
const store = await labStore(), by = {}, all = {};
for (const id of ids.split(",")) for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) {
  for (const line of ((await store.get(name)) || "").split("\n")) {
    if (line.startsWith('{"game"')) all[id] = (all[id] || 0) + 1;
    if (!line.includes('"vs"')) continue;
    const o = JSON.parse(line);
    if (o.game == null || !o.vs) continue;
    const r = (by[`${id} ${o.vs.nets}`] ||= { n: 0, won: 0, draw: 0, lostResigned: 0, wonByResign: 0, lostPlayed: 0, would: 0, wouldWon: 0, seat: [[0, 0], [0, 0]], turns: [], why: {} });
    const mine = 1 - o.vs.seat;
    r.n++; r.turns.push(o.turns); r.seat[mine][0]++;
    if (o.would && o.would.seat === mine) { r.would++; if (o.winner === mine) r.wouldWon++; }
    if (o.winner < 0) { r.draw++; continue; }
    const won = o.winner === mine; r.why[o.why] = (r.why[o.why] || 0) + 1;
    if (won) { r.won++; r.seat[mine][1]++; if (o.resign) r.wonByResign++; }
    else if (o.resign) r.lostResigned++; else r.lostPlayed++;
  }
}
console.log(`games in: ${JSON.stringify(all)}`);
for (const [k, r] of Object.entries(by)) {
  const t = r.turns.sort((a, b) => a - b);
  console.log(`${k}: ${r.n} games, the latest nets won ${r.won} (${(100 * (r.won + r.draw / 2) / r.n).toFixed(1)}%), ${r.draw} drawn`);
  console.log(`  lost by resigning ${r.lostResigned}, lost played out ${r.lostPlayed}, won when the rival resigned ${r.wonByResign}; would have resigned ${r.would}, of those won ${r.wouldWon}`);
  console.log(`  as first player ${r.seat[0][1]}/${r.seat[0][0]}, as second ${r.seat[1][1]}/${r.seat[1][0]}; median turns ${t[t.length >> 1]}; endings ${JSON.stringify(r.why)}`);
}
