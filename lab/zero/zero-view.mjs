// Zero's extended view and Scry: dandan-zeroview.js (the app's copy since 15 Nov 2026, one code for the lab and the game lab),
// and the lab's net reader.
import fs from "node:fs";
export * from "../../dandan-zeroview.js";
export const readNet = path => (fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8").split("\n")[0]) : null);
