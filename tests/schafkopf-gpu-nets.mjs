// The GPU engine's nets (lab/schafkopf/gpu/sk_net_t.py) are sk-net.js's: M1 (raw view, partner facts, the own and the public
// belief) on 80 Sauspiel-first deals traced with the JS outputs for the seat to move, replayed as one tensor batch, within 1e-4
// (gpu/test_nets.py). Skipped where PyTorch isn't installed.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
if (spawnSync("python3", ["-c", "import torch"]).status !== 0) { console.log("schafkopf-gpu-nets: skipped (no PyTorch here)"); process.exit(0); }
const net = "lab/schafkopf/nets/m1-policy-m1.json", file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "skgpu-")), "trace.jsonl");
fs.writeFileSync(file, execFileSync("node", [path.join(root, "lab/schafkopf/gpu/trace.mjs"), "80", "71", "sau"], { encoding: "utf8", env: { ...process.env, NET: net }, maxBuffer: 1 << 28 }));
const r = spawnSync("python3", [path.join(root, "lab/schafkopf/gpu/test_nets.py"), file, path.join(root, net)], { encoding: "utf8" });
process.stdout.write(r.stdout.split("\n").slice(-2).join("\n"));
if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
