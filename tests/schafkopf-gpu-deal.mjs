// The GPU dealer (lab/schafkopf/gpu/sk_deal_t.py): on late positions every draw is a valid world (the record replays) and the
// draws spread evenly over all valid worlds, found by exact enumeration (gpu/test_deal.py, a chi-square test). Skipped where
// PyTorch isn't installed.
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
if (spawnSync("python3", ["-c", "import torch"]).status !== 0) { console.log("schafkopf-gpu-deal: skipped (no PyTorch here)"); process.exit(0); }
const r = spawnSync("python3", [path.join(root, "lab/schafkopf/gpu/test_deal.py"), "5", "800"], { encoding: "utf8" });
process.stdout.write(r.stdout.split("\n").slice(-2).join("\n"));
if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
