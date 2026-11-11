// lab.html's start: the game lab opens only with the key in the address, as games.html does (games-key.js); without it the visitor is
// sent to the game. With it, the page raises the lab flag that dandan.js looks for (and index.html never sets), puts the settings
// gear among the buttons (to the game history), and loads the game, which is then exactly the game index.html serves, plus the lab
// (dandan-lab.js: the opponent's engine, the coaches, the sheet that describes each engine).
import { keyOk } from "./games-key.js";
import { mountSettings } from "./lab-nav.js";

if (!(await keyOk(new URLSearchParams(location.search).get("k")))) location.replace("./");
else {
  globalThis.__dandanLab = { engine: null };       // the lab fills in the opponent from what the owner chose last time
  mountSettings("lab");
  await import("./dandan.js");
}
