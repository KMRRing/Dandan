// Two builds of the computer (a snapshot directory each, as lab/match.mjs) at positions with a short library: what each plays there,
// set against the best move a long search of the NEW build's own machinery finds, in the same deals (the best chosen on one half of the
// deals and judged on the other, both ways round, as lab/regret.mjs): the win chance each gives up. The reference is the new build's, so it
// favours the new build; the match (LIBCUT) is the fair test, this one says where and how much the moves differ.
// usage: node lab/deckregret.mjs <base dir> <new dir> <positions.jsonl> <shard> <shards> <reference deals> <out.jsonl>
//        node lab/deckregret.mjs report <out.jsonl>...
import fs from "node:fs";
import path from "node:path";
import { J } from "./lib.mjs";

const key = m => JSON.stringify(m);
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const [first, ...rest] = process.argv.slice(2);
if (first === "report") {
  const rows = rest.flatMap(f => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
  const regret = (r, i) => {
    let reg = 0;
    for (const [a, b] of [[0, 1], [1, 0]]) {
      const part = (j, h) => mean(r.vals[j].filter((_, d) => d % 2 === h));
      let best = 0;
      r.vals.forEach((_, j) => { if (part(j, a) > part(best, a)) best = j; });
      reg += part(best, b) - part(i, b);
    }
    return reg / 2;
  };
  const out = { base: [], next: [] }, differ = [];
  for (const r of rows) { out.base.push(regret(r, r.baseAt)); out.next.push(regret(r, r.newAt)); if (r.baseAt !== r.newAt) differ.push(r); }
  const se = a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)) / a.length);
  const diff = out.base.map((x, i) => x - out.next[i]);
  const hold = rows.filter(r => JSON.parse(r.cands[r.newAt]).hold).length, held = rows.filter(r => r.cands.some(c => JSON.parse(c).hold)).length;
  console.log(`${rows.length} positions; the two builds choose differently in ${differ.length} (${(100 * differ.length / rows.length).toFixed(0)}%)`);
  console.log(`mean regret: base ${(100 * mean(out.base)).toFixed(2)} ± ${(100 * se(out.base)).toFixed(2)} points, new ${(100 * mean(out.next)).toFixed(2)} ± ${(100 * se(out.next)).toFixed(2)}; the new gains ${(100 * mean(diff)).toFixed(2)} ± ${(100 * se(diff)).toFixed(2)}`);
  console.log(`positions with a hold-priority move among the candidates: ${held}; the new build's choice holds priority in ${hold}`);
  process.exit(0);
}
const [baseDir, newDir, file, shard, shards, deals, out] = [path.resolve(first), path.resolve(rest[0]), rest[1], Number(rest[2]), Number(rest[3]), Number(rest[4]), rest[5]];
const B = await import(`${baseDir}/dandan-think.js`), N = await import(`${newDir}/dandan-think.js`);
const E = await import(`${newDir}/dandan-engine.js`), S = await import(`${newDir}/seats.js`);
const rows = fs.readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l)).filter((_, i) => i % shards === shard);
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l).id) : []);
for (const r of rows) {
  if (done.has(r.id)) continue;
  const s = E.restore(J(r.st)), seat = r.who;
  const baseMove = B.thinkMove(E.restore(J(r.st)), seat), newMove = N.thinkMove(E.restore(J(r.st)), seat);
  const cands = N.candidates(s, seat, { wide: 12 });
  const at = m => { let i = cands.findIndex(c => key(c) === key(m)); if (i < 0) { cands.push(m); i = cands.length - 1; } return i; };
  const baseAt = at(baseMove), newAt = at(newMove);
  const to = s.turn + Math.max(2, N.endOfLibrary(s)), seed = N.seedOf(s, seat);
  const roots = cands.map(() => ({ n: 0, kids: new Map() })), vals = cands.map(() => []);
  for (let d = 0; d < deals; d++) {
    const rng = S.seeded(S.mix(seed, d + 1)), base = N.determinize(s, seat, rng), runSeed = S.mix(seed ^ 0x5eed, d + 7);
    cands.forEach((m, i) => {
      const c = N.fork(base), q = S.seeded(runSeed), res = E.act(c, seat, m, { rng: q, quiet: true });
      vals[i].push(typeof res === "string" ? -1 : N.treePlay(c, seat, roots[i], to, q));
    });
  }
  fs.appendFileSync(out, JSON.stringify({ id: r.id, who: seat, turn: s.turn, lib: s.lib.length, n: cands.length, baseAt, newAt, cands: cands.map(key), vals: vals.map(v => v.map(x => +x.toFixed(4))) }) + "\n");
}
