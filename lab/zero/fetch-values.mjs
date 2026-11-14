// Zero's value rows (lab/zero/zero-play.mjs's { v: 1, f: [mine, theirs], won, hold, x3 } lines) packed for lab/zero/value_np.py
// (14 Nov 2026): mine.f32 and theirs.f32 (N numbers a row), won.f32, hold.u8; a row from a game with a random move (explore3)
// is kept only when it comes after that move (x3 1), as No. 13 point 5 says. One part at a time.
// usage: node lab/zero/fetch-values.mjs <folder> <zero-play job ids, comma-separated>
import fs from "node:fs";
import { labStore } from "../lib.mjs";

const [dir, ids] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const fd = Object.fromEntries(["mine.f32", "theirs.f32", "won.f32", "hold.u8"].map(n => [n, fs.openSync(`${dir}/${n}`, "w")]));
const put = (n, a) => fs.writeSync(fd[n], Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const store = await labStore();
let N = 0, R = 0, skipped = 0;
for (const id of ids.split(",")) for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) {
  const rows = [];
  for (const line of ((await store.get(name)) || "").split("\n")) {
    if (!line.startsWith('{"v":1')) continue;
    const r = JSON.parse(line);
    if (r.x3 != null && r.x3 < 1) { skipped++; continue; }
    rows.push(r);
  }
  if (!rows.length) continue;
  N ||= rows[0].f[0].length;
  const mine = new Float32Array(rows.length * N), theirs = new Float32Array(rows.length * N), won = new Float32Array(rows.length), hold = new Uint8Array(rows.length);
  rows.forEach((r, i) => { mine.set(r.f[0], i * N); theirs.set(r.f[1], i * N); won[i] = r.won; hold[i] = r.hold ? 1 : 0; });
  put("mine.f32", mine); put("theirs.f32", theirs); put("won.f32", won); put("hold.u8", hold);
  R += rows.length;
}
for (const f of Object.values(fd)) fs.closeSync(f);
fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ N, rows: R, skipped, ids }));
console.log(`packed ${R} value rows (${N} inputs), ${skipped} before a random move skipped`);
