// Export jobs (lab/export.mjs) packed into flat binary files for the NumPy move-picker trainer, lab/policy_np.py (14 Nov 2026,
// Fable No. 9 point 5). One pass over the bucket's part files; nothing is held but one part at a time.
// Out, in <folder>: meta.json { XN, decisions, candidates, marks, exports, every }, and per decision x.f32 (XN numbers),
// cand.i32 (the first candidate's index; one more at the end), pick.i16 (the search's move, a candidate index), med.i16
// (Medium's pick), flags.u8 (1 held out, 2 Deep, 4 every legal move weighed, 8 the search played off Medium's shortlist);
// per candidate q.f32 (the search's mean), mark.i32 (the first mark's index; one more at the end); per mark marks.u8.
// A candidate's first mark is its kind (0 pass, 1 land, 2 cast, 3 cycle, 4 ability: dandan-netpolicy.js marksOf).
// usage: node lab/fetch-ex.mjs <folder> <export ids, comma-separated> [every: only decisions where every legal move was weighed | q]
import fs from "node:fs";
import { labStore } from "./lib.mjs";

const [dir, ids, only] = [process.argv[2], process.argv[3], process.argv[4]];
// "every": decisions with priority where every legal move was weighed; "q" (14 Nov 2026, Zero): only the questions (qd lines)
const EVERY = only === "every" || only === "q", Q = only === "q";
fs.mkdirSync(dir, { recursive: true });
const names = ["x.f32", "cand.i32", "pick.i16", "med.i16", "flags.u8", "q.f32", "mark.i32", "marks.u8"];
const fd = Object.fromEntries(names.map(n => [n, fs.openSync(`${dir}/${n}`, "w")]));
const put = (n, typed) => fs.writeSync(fd[n], Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength));
let XN = 0, D = 0, C = 0, K = 0;
const store = await labStore();
for (const id of ids.split(",")) {
  const parts = (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n));
  let n0 = D;
  for (const name of parts) {
    const lines = ((await store.get(name)) || "").split("\n").filter(Boolean);
    const ds = [];
    for (const line of lines) { const d = JSON.parse(line); if (EVERY && !d.every) continue; if (!!d.qd !== Q) continue; ds.push(d); }
    if (!ds.length) continue;
    XN ||= ds[0].x.length;
    const nc = ds.reduce((a, d) => a + d.c.length, 0), nk = ds.reduce((a, d) => a + d.c.reduce((b, c) => b + c.m.length, 0), 0);
    const x = new Float32Array(ds.length * XN), cand = new Int32Array(ds.length), pick = new Int16Array(ds.length), med = new Int16Array(ds.length), flags = new Uint8Array(ds.length);
    const q = new Float32Array(nc), mark = new Int32Array(nc), marks = new Uint8Array(nk);
    let c = 0, k = 0;
    ds.forEach((d, i) => {
      if (d.x.length !== XN) throw new Error(`${name}: ${d.x.length} inputs, not ${XN}`);
      x.set(d.x, i * XN); cand[i] = C + c;
      const p = d.pick != null && d.pick >= 0 && d.pick < d.c.length ? d.pick : d.c.reduce((b, cc, j) => (cc.q > d.c[b].q ? j : b), 0);
      pick[i] = p; med[i] = d.med ?? 0;
      flags[i] = (d.hold ? 1 : 0) | (d.deep ? 2 : 0) | (d.every ? 4 : 0) | (d.off ? 8 : 0);
      for (const cc of d.c) {
        if (!cc.m.length) throw new Error(`${name}: a candidate with no marks`);
        q[c] = cc.q; mark[c] = K + k; c++;
        for (const m of cc.m) marks[k++] = m;
      }
    });
    put("x.f32", x); put("cand.i32", cand); put("pick.i16", pick); put("med.i16", med); put("flags.u8", flags);
    put("q.f32", q); put("mark.i32", mark); put("marks.u8", marks);
    D += ds.length; C += nc; K += nk;
  }
  console.log(`${id}: ${parts.length} parts, ${D - n0} decisions`);
}
put("cand.i32", Int32Array.of(C)); put("mark.i32", Int32Array.of(K));
for (const f of Object.values(fd)) fs.closeSync(f);
fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ XN, decisions: D, candidates: C, marks: K, exports: ids, every: EVERY }));
console.log(`packed ${D} decisions, ${C} candidates, ${K} marks, ${XN} position inputs`);
