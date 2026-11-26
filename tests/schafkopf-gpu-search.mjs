// The GPU search (lab/schafkopf/gpu/sk_search_t.py) is the JS search: given the GPU's own worlds and option orders
// (gpu/worlds_dump.py), the JS search (gpu/exact_check.mjs) must give every root option the same mean and the same number of
// deals on four fixed positions, a bid among them. 26 Nov 2026: this check found the tree's move at a new node being
// overwritten by the policy's, and ties going by action number rather than option order. Skipped where PyTorch isn't installed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."), gpu = path.join(root, "lab/schafkopf/gpu");
if (spawnSync("python3", ["-c", "import importlib.util, sys; sys.exit(importlib.util.find_spec('torch') is None)"]).status !== 0) { console.log("schafkopf-gpu-search: skipped (no PyTorch here)"); process.exit(0); }
const pos = path.join(gpu, "positions-check.jsonl"), net = "lab/schafkopf/nets/m1-policy-m1.json", tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skg-"));
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", cwd: root }); if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); } return r.stdout; };
run("python3", [path.join(gpu, "worlds_dump.py"), pos, "8", "1", path.join(tmp, "w.jsonl")]);
const js = run("node", [path.join(gpu, "exact_check.mjs"), pos, path.join(tmp, "w.jsonl"), net, "8"]).split("\n").filter(Boolean).map(JSON.parse);
run("python3", [path.join(gpu, "compare.py"), pos, path.join(root, net), "8", "8", "cpu", "1", "--dump", path.join(tmp, "g.jsonl")]);
const g = fs.readFileSync(path.join(tmp, "g.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
let bad = 0;
js.forEach((x, i) => {
  const o = new Map(g[i].opts.map(q => [q[0], q]));
  for (const [a, m, n] of x.opts) if (!o.has(a) || Math.abs(o.get(a)[1] - m) > 1e-4 || o.get(a)[2] !== n) { bad++; console.error(`position ${i} option ${a}: JS ${m.toFixed(4)} over ${n}, GPU ${o.get(a)?.[1]?.toFixed(4)} over ${o.get(a)?.[2]}`); }
});
fs.rmSync(tmp, { recursive: true });
if (bad) process.exit(1);
console.log(`schafkopf-gpu-search: ${js.length} positions, every option's mean and deals the same in both searches`);
