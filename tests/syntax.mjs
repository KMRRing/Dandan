// Every script the page loads parses as the ES module it is. `node --check` on its own does NOT catch a syntax error in a
// module on Node 22 (it falls back quietly and exits 0), so this asks for the module reading; one missing brace in a script
// once passed every test and stopped a game at "Loading". It gates the service worker's publication (.github/workflows/pages.yml):
// a push that can't even parse never reaches installed copies.
import { execFileSync } from "child_process";
import { ROOT, offlineFiles } from "../tools/offline.mjs";

let bad = 0;
const scripts = offlineFiles().filter(f => f.endsWith(".js"));
for (const f of scripts) {
  try { execFileSync(process.execPath, ["--experimental-default-type=module", "--check", ROOT + f], { stdio: "pipe" }); }
  catch (e) { bad++; console.log(`FAIL ${f}: ${String(e.stderr || e.message).split("\n").slice(0, 4).join(" | ")}`); }
}
console.log(`${bad ? "FAIL" : "ok  "} ${scripts.length} scripts parse as modules`);
process.exit(bad ? 1 : 0);
