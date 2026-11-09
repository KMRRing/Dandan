// Where do the computers choose differently? (9 November 2026) Games are played by Hard of the current build on both seats; at every
// decision with a choice, the move of four players on the same position and the same random numbers is kept: Hard of this
// build (the one that plays), Hard of the old ref, Medium of this build, Medium of the old ref. Each is also given as a name
// (dandan-words moveName) so the differences can be sorted by kind.
// usage: node lab/diverge.mjs <shard> <shards> <out.jsonl> <games> <hard deals 64> <old ref> [first seed 20000]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { J } from "./lib.mjs";
const [shard, shards, out, games, deals, oldRef, seed0] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5]), Number(process.argv[6] || 64), process.argv[7], Number(process.argv[8] || 20000)];
const git = (...a) => execFileSync("git", a, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
git("fetch", "-q", "--depth=1", "origin", oldRef);
const oldDir = path.resolve("..", "diverge-old"); git("worktree", "add", "-q", "--detach", oldDir, "FETCH_HEAD");
const newDir = path.resolve(".");
const load = async dir => ({ th: await import(`${dir}/dandan-think.js`), pol: await import(`${dir}/dandan-policy.js`), eng: await import(`${dir}/dandan-engine.js`), rules: (await import(`${dir}/dandan-rules.js`)).rules, words: await import(`${dir}/dandan-words.js`) });
const N = await load(newDir), O = await load(oldDir);
const { newRecord, applyMove, seeded, mix } = await import(`${newDir}/seats.js`);
const base = Math.floor(games / shards), extra = games % shards, first = shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);
const realRandom = Math.random;
const key = m => JSON.stringify(m);
for (let g = first; g < first + n; g++) {
  let G = newRecord(N.rules, { seats: 2, seed: seed0 + g, now: 0 });
  for (let i = 0; i < 4000 && !N.rules.over(G.state); i++) {
    const who = N.rules.toMove(G.state), p = G.state.pending;
    const s = N.rules.restore(J(G.state)), seed = mix(seed0 + g, i + 1);
    let move;
    if (p && ["mull", "bottom", "name"].includes(p.t)) { Math.random = seeded(seed); move = N.pol.policyMove(s, who); }
    else if (!p && !N.eng.moves(s, who, true).length) move = N.pol.PASS;
    else {
      const ask = (M, f) => { const st = M.rules.restore(J(G.state)); Math.random = seeded(seed); return f(M, st); };
      move = ask(N, (M, st) => M.th.thinkMove(st, who, { deals, ms: 1e9 }));
      if (N.eng.moves(s, who, true).length > 1 || p) {
        const oh = ask(O, (M, st) => M.th.thinkMove(st, who, { deals, ms: 1e9 }));
        const nm = ask(N, (M, st) => M.pol.policyMove(st, who, { rng: Math.random }));
        const om = ask(O, (M, st) => M.pol.policyMove(st, who, { rng: Math.random }));
        const nameOf = (M, m) => M.words.moveName(m, M.rules.restore(J(G.state)), who);
        fs.appendFileSync(out, JSON.stringify({ game: g, i, seat: who, turn: s.turn, step: s.step, lib: s.lib.length, stack: s.stack.length, life: s.life,
          nh: nameOf(N, move), oh: nameOf(O, oh), nm: nameOf(N, nm), om: nameOf(O, om),
          hh: key(move) === key(oh) ? 1 : 0, nhm: key(move) === key(nm) ? 1 : 0, ohm: key(oh) === key(om) ? 1 : 0, mm: key(nm) === key(om) ? 1 : 0 }) + "\n");
      }
    }
    Math.random = realRandom;
    G = applyMove(N.rules, G, who, move, 0).G;
  }
}
