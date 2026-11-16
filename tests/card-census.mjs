// Stage 3, step 1 (Fable's brief, 16 Nov 2026): card names outside the card files, on Zero 2's path. Stage 3 is done when the
// code above the rules knows only the two decklists; each card name written into it is a piece of Dandan built in by hand. This
// counts each file's card names in quoted strings outside comments and fails if any file has more than it is allowed. The
// allowances only go down: a step that removes names lowers them here, and the count is driven to 0.
import fs from "node:fs";
import { NAMES } from "../dandan-cards.js";

const ALLOWED = {   // 16 Nov 2026, 21:00Z
  "dandan-netpolicy.js": 28, "dandan-think.js": 4, "dandan-zero.js": 2, "dandan-zeroview.js": 0,
  "lab/zero/zero2.mjs": 2, "lab/zero/scry12.mjs": 0, "lab/zero/zero-view.mjs": 0, "lab/zero/zero-lib.mjs": 0, "lab/zero/replay-pack2.mjs": 0,
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), quoted = new RegExp(`["'\`](${NAMES.map(esc).join("|")})["'\`]`, "g");
/** The source without its comments, strings kept whole ("Commit // Memory" is a card name, not a comment). Regex literals are
 *  rare enough in these files not to matter; a quote inside one could only make a count too high, never hide a name. */
function withoutComments(src) {
  let out = "", q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { out += c; if (c === "\\") { out += src[++i] ?? ""; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2); if (i < 0) break; i++; continue; }
    out += c;
  }
  return out;
}
let fails = 0, total = 0;
const rows = [];
for (const [f, allowed] of Object.entries(ALLOWED)) {
  const code = withoutComments(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
  const found = code.match(quoted) || [];
  total += found.length;
  if (found.length > allowed) { fails++; rows.push(`FAIL ${f}: ${found.length} card names, allowed ${allowed} (${[...new Set(found)].join(", ")})`); }
  else if (found.length < allowed) rows.push(`     ${f}: ${found.length}, allowed ${allowed}: lower its allowance`);
}
console.log(`${fails ? "FAIL" : "ok  "} card names outside the card files on Zero 2's path: ${total} (allowed ${Object.values(ALLOWED).reduce((a, b) => a + b, 0)}; the goal is 0)`);
for (const r of rows) console.log(r);
if (fails) process.exit(1);
