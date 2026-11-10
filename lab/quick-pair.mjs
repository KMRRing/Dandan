// A quick match of two builds at Medium (lab/quick-match.mjs) over thousands of deals, a share of them in each Lab job: the builds
// are two git refs of this repository (the champion, the candidate). Every deal is played twice with the seats swapped.
// usage: node lab/quick-pair.mjs <shard> <shards> <out.jsonl> <pairs> <champion ref> <candidate ref> [player: medium | hard<deals>] [late: 0, see quick-match.mjs]
// A row's aWon is the champion's score; the candidate's is one minus it.
import { execFileSync } from "node:child_process";
import path from "node:path";
const [shard, shards, out, pairs, refA, refB, spec = "medium", late = "0"] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5]), process.argv[6], process.argv[7], process.argv[8], process.argv[9]];
const git = (...a) => execFileSync("git", a, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const tree = (ref, name) => { git("fetch", "-q", "--depth=1", "origin", ref); const dir = path.resolve("..", name); git("worktree", "add", "-q", "--detach", dir, "FETCH_HEAD"); return dir; };
const A = tree(refA, "quick-champion"), B = tree(refB, "quick-candidate");
const base = Math.floor(pairs / shards), extra = pairs % shards, first = shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);
execFileSync(process.execPath, ["lab/quick-match.mjs", A, B, String(first), String(n), out, spec, late], { stdio: "inherit" });
