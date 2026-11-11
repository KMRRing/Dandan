// What the app keeps on the device so it opens with no connection: every file of its own kinds outside the tests, the
// tools, the lab and the workflows. The app is small (under a megabyte), so the list is "everything that ships" rather than
// what each page is found to load: a file that is loaded in some way a reading can't follow is still there, and
// tests/offline.mjs checks the other way, that nothing a page names is left out.
import fs from "fs";
import { execSync } from "child_process";

export const ROOT = new URL("..", import.meta.url).pathname;

/** Never kept: the tests, the tools, the lab and the workflows; and the service worker itself (the browser fetches that). */
export const NEVER = f => /^(?:tests|tools|lab|\.github)\//.test(f) || f === "sw.js";
/** The kinds of file the app is made of. */
export const SHIP = /\.(?:html|js|css|webmanifest|json|woff2|png|svg)$/;   // json: the lab's retrained judges (judges/, dandan-engines.js)

/** Every file kept offline, sorted: the git index and what is new and not ignored (so a file not yet committed is tried too). */
export function offlineFiles(root = ROOT) {
  const listed = execSync("git ls-files --cached --others --exclude-standard", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  return [...new Set(listed)].filter(f => !NEVER(f) && SHIP.test(f) && fs.existsSync(root + f)).sort();
}
