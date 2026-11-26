// The GPU engine's views (lab/schafkopf/gpu/sk_view_t.py) are sk-view.js's: 120 Sauspiel-first deals traced with the JS raw
// and partner views of two seats at every step, replayed as one tensor batch and compared exactly (gpu/test_views.py).
// Skipped where PyTorch isn't installed.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
if (spawnSync("python3", ["-c", "import torch"]).status !== 0) { console.log("schafkopf-gpu-views: skipped (no PyTorch here)"); process.exit(0); }
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "skgpu-")), "trace.jsonl");
fs.writeFileSync(file, execFileSync("node", [path.join(root, "lab/schafkopf/gpu/trace.mjs"), "120", "61", "sau", "views"], { encoding: "utf8", maxBuffer: 1 << 28 }));
const r = spawnSync("python3", [path.join(root, "lab/schafkopf/gpu/test_views.py"), file], { encoding: "utf8" });
process.stdout.write(r.stdout.split("\n").slice(-2).join("\n"));
if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
