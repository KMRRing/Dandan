// Each side's searching time in a match (24 Nov 2026, Fable 08:50Z: equal deals, time measured): from zero-play's game lines
// (clock: each seat's [seconds, searched decisions]), our side (the seat that is not vs.seat) against the rival, seconds per
// decision over all games, and the ratio. Read-only.
// usage: node lab/clock-sum.mjs <batch>
const [id] = process.argv.slice(2), store = await (await import("./lib.mjs")).labStore();
const t = { ours: [0, 0], rival: [0, 0] };
let games = 0;
for (const n of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)))
  for (const l of ((await store.get(n)) || "").split("\n")) {
    if (!l.startsWith('{"game"')) continue;
    const g = JSON.parse(l);
    if (!g.clock || !g.vs) continue;
    games++;
    for (const seat of [0, 1]) { const side = seat === g.vs.seat ? t.rival : t.ours; side[0] += g.clock[seat][0]; side[1] += g.clock[seat][1]; }
  }
const per = ([s, n]) => (n ? s / n : 0);
console.log(`${id}: ${games} games with clocks; our side ${per(t.ours).toFixed(2)} s a decision (${t.ours[1]} decisions), the rival ${per(t.rival).toFixed(2)} s (${t.rival[1]}); ratio ${(per(t.ours) / Math.max(1e-9, per(t.rival))).toFixed(3)}`);
