// The read of sk-dad.mjs (Fable, 25 Nov 2026 16:20Z, step 0): the questioned lead less the best other, in the declarer side's
// tariffs (A: a Solo's declarer is paid by three, so per defender divide by three), paired by position; the share where Monte
// zero itself chose the questioned lead (the meter); and for B, the cost split by whether the other lead still kept the partner
// hidden after the next trick. Read-only.
// usage: node lab/sk-dad-sum.mjs <job[+re-run][,another job...]> (jobs joined by "," are pooled, each read whole) [--dir <local folder of part-*.jsonl, for a test>]
import fs from "node:fs";

const args = process.argv.slice(2), at = args.indexOf("--dir"), dir = at >= 0 ? args.splice(at, 2)[1] : null;
const lines = new Map();
// the same positions recur in every engine's job (same deals): a re-run ("+") replaces its job's copy, another engine's job (",") adds
const read = (t, g = 0) => { for (const l of t.split("\n")) if (l.startsWith("{")) { const x = JSON.parse(l); lines.set(`${g}:${x.seed}:${x.trick}`, x); } };
if (dir) for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"))) read(fs.readFileSync(`${dir}/${f}`, "utf8"));
else {
  const { labStore } = await import("./lib.mjs"), store = await labStore();
  for (const [g, job] of args[0].split(",").entries()) for (const id of job.split("+")) for (const n of (await store.list(`results/${id}/`)).filter(n => /part-\d+\.jsonl$/.test(n))) { try { read((await store.get(n)) || "", g); } catch { /* a part being written */ } }
}
const all = [...lines.values()];
const stat = xs => {
  const n = xs.length, m = xs.reduce((a, x) => a + x, 0) / n, se = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1) / n);
  return `${m >= 0 ? "+" : ""}${m.toFixed(3)} ± ${se.toFixed(3)} (${n})`;
};
const line = (label, xs) => xs.length > 1 && console.log(`${label}: questioned less best other, declarer side's payoff ${stat(xs.map(x => x.pa - x.pb))}; declarer won ${stat(xs.map(x => (x.pa > 0) - (x.pb > 0)))}; the engine chose the questioned lead in ${(100 * xs.filter(x => x.chose).length / xs.length).toFixed(1)}%`);
const kind = all[0]?.kind;
// counter lines (sk-dad.mjs counter=, Korbi 27 Nov 14:17 local): each defence rule against plain M1 defence on the same lead and seeds;
// a negative number is the rule punishing the declarer's choice
const counters = Object.keys(all[0] || {}).filter(k => /^paK\d$/.test(k)).map(k => k.slice(2));
if (counters.length) {
  line(`${args[0] || dir} (${kind}), plain defence`, all);
  for (const k of counters) {
    const after = (x, l) => x[`p${l}${k}`] - x[`p${l}`];
    console.log(`  defence ${k} less plain, declarer side's payoff: after the engine's lead ${stat(all.map(x => after(x, "a")))}, after the rule's pick ${stat(all.map(x => after(x, "b")))}; the difference (negative: ${k} punishes the engine's lead) ${stat(all.map(x => after(x, "a") - after(x, "b")))}`);
  }
  process.exit(0);
}
line(`${args[0] || dir} (${kind}), all`, all);
// the father's probe on these positions (Fable 27 Nov 09:15Z): where the engine itself chose the questioned lead, the difference
// is what his rule would change (the questioned lead against the best other, the rule's own pick), and nowhere else does it act
line("  where the engine chose the questioned lead (what the rule changes)", all.filter(x => x.chose));
for (const t of [...new Set(all.map(x => x.type))]) line(`  ${t}`, all.filter(x => x.type === t));
if (kind === "B") {
  line("  the other lead kept the partner hidden past the next trick", all.filter(x => x.fb == null || x.fb > x.trick + 1));
  line("  the other lead showed the partner by the next trick", all.filter(x => x.fb != null && x.fb <= x.trick + 1));
}
