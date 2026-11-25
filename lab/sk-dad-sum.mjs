// The read of sk-dad.mjs (Fable, 25 Nov 2026 16:20Z, step 0): the questioned lead less the best other, in the declarer side's
// tariffs (A: a Solo's declarer is paid by three, so per defender divide by three), paired by position; the share where Monte
// zero itself chose the questioned lead (the meter); and for B, the cost split by whether the other lead still kept the partner
// hidden after the next trick. Read-only.
// usage: node lab/sk-dad-sum.mjs <job[+re-run]> [--dir <local folder of part-*.jsonl, for a test>]
import fs from "node:fs";

const args = process.argv.slice(2), at = args.indexOf("--dir"), dir = at >= 0 ? args.splice(at, 2)[1] : null;
const lines = new Map();
const read = t => { for (const l of t.split("\n")) if (l.startsWith("{")) { const x = JSON.parse(l); lines.set(`${x.seed}:${x.trick}`, x); } };
if (dir) for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"))) read(fs.readFileSync(`${dir}/${f}`, "utf8"));
else {
  const { labStore } = await import("./lib.mjs"), store = await labStore();
  for (const id of args[0].split("+")) for (const n of (await store.list(`results/${id}/`)).filter(n => /part-\d+\.jsonl$/.test(n))) { try { read((await store.get(n)) || ""); } catch { /* a part being written */ } }
}
const all = [...lines.values()];
const stat = xs => {
  const n = xs.length, m = xs.reduce((a, x) => a + x, 0) / n, se = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1) / n);
  return `${m >= 0 ? "+" : ""}${m.toFixed(3)} ± ${se.toFixed(3)} (${n})`;
};
const line = (label, xs) => xs.length > 1 && console.log(`${label}: questioned less best other, declarer side's payoff ${stat(xs.map(x => x.pa - x.pb))}; declarer won ${stat(xs.map(x => (x.pa > 0) - (x.pb > 0)))}; the engine chose the questioned lead in ${(100 * xs.filter(x => x.chose).length / xs.length).toFixed(1)}%`);
const kind = all[0]?.kind;
line(`${args[0] || dir} (${kind}), all`, all);
for (const t of [...new Set(all.map(x => x.type))]) line(`  ${t}`, all.filter(x => x.type === t));
if (kind === "B") {
  line("  the other lead kept the partner hidden past the next trick", all.filter(x => x.fb == null || x.fb > x.trick + 1));
  line("  the other lead showed the partner by the next trick", all.filter(x => x.fb != null && x.fb <= x.trick + 1));
}
