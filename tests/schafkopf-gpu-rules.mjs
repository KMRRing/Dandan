// The GPU engine's Schafkopf rules (lab/schafkopf/gpu/sk_rules_t.py) are Codex's: 1,000 deals of random legal play traced
// from Codex itself (gpu/trace.mjs, half of them Sauspiel-first), replayed as one tensor batch, every seat to move, every legal
// set and every payoff compared (gpu/test_rules.py). Skipped where PyTorch isn't installed (the pages runner).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
if (spawnSync("python3", ["-c", "import torch"]).status !== 0) { console.log("schafkopf-gpu-rules: skipped (no PyTorch here)"); process.exit(0); }
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "skgpu-")), "trace.jsonl");
const trace = n => execFileSync("node", [path.join(root, "lab/schafkopf/gpu/trace.mjs"), "500", String(n), ...(n % 2 ? ["sau"] : [])], { encoding: "utf8" });
fs.writeFileSync(file, trace(41) + trace(42));
const r = spawnSync("python3", [path.join(root, "lab/schafkopf/gpu/test_rules.py"), file], { encoding: "utf8" });
process.stdout.write(r.stdout.split("\n").slice(-2).join("\n"));
if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
