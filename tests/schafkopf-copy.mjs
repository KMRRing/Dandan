// The lab's copy of Codex's Schafkopf rules (Fable, 24 Nov 2026 18:50Z: copy, not a submodule; Korbi: "Codex plays good
// rules"): every file must be byte for byte the blob of the Crates commit recorded in CODEX.json. A widened rule set is a
// change in Crates first, then a new copy here, never an edit to these files.
import fs from "node:fs";
import crypto from "node:crypto";
const dir = new URL("../lab/schafkopf/codex/", import.meta.url), rec = JSON.parse(fs.readFileSync(new URL("CODEX.json", dir)));
const blob = b => crypto.createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex");
let bad = 0;
for (const [f, sha] of Object.entries(rec.files)) {
  const got = blob(fs.readFileSync(new URL(f, dir)));
  if (got !== sha) { console.error(`schafkopf-copy: ${f} differs from Crates ${rec.commit.slice(0, 9)} (${got.slice(0, 9)} vs ${sha.slice(0, 9)}): copy it again, don't edit it`); bad++; }
}
const extra = fs.readdirSync(dir).filter(f => f.endsWith(".js") && !rec.files[f]);
if (extra.length) { console.error(`schafkopf-copy: not from Crates: ${extra.join(", ")}`); bad++; }
if (bad) process.exit(1);
console.log(`schafkopf-copy: ${Object.keys(rec.files).length} files match Crates ${rec.commit.slice(0, 9)}`);
