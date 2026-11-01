// Collects the finished games from the database into a folder (the `game-records` branch, by .github/workflows/games.yml):
//   games/<key>.json   one game: { key, room, line (its index line), game (as kept: seed, seats, moves, state…), result }
//   index.json         every game's summary, oldest first
//   status.json        when it last found anything, how many it has, what went wrong
// It reads as any visitor to the page does, signing in anonymously with the page's own public key, so it needs no secret:
// the index room (records.js) lists every game with the room it is in, and a game it already has is not fetched again.
// usage: node tools/pull-games.mjs <folder>        (IDENTITY_URL and DB_URL are for the test, which runs a stand-in)
import fs from "node:fs";
import path from "node:path";
import { INDEX_ROOM } from "../records.js";

const API_KEY = "AIzaSyCfl6mWI_7cf2VYnpxXB9WwTU_weoH8vA0";               // the page's own (public by design; sync.js)
const IDENTITY = process.env.IDENTITY_URL || "https://identitytoolkit.googleapis.com/v1/accounts:signUp";
const DBS = process.env.DB_URL ? [process.env.DB_URL] : ["https://croatiabio-default-rtdb.europe-west1.firebasedatabase.app", "https://croatiabio-default-rtdb.firebaseio.com"];
// a key can be limited to the pages that may use it; say we come from the page
const HEADERS = { "content-type": "application/json", referer: "https://kmrring.github.io/", origin: "https://kmrring.github.io" };

const dir = process.argv[2] || "records";
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); } catch { return fallback; } };
const write = (file, v) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), JSON.stringify(v)); };
const errors = [];
const fail = (what, e) => { errors.push(`${what}: ${e?.message || e}`); console.error(what, e?.message || e); };

async function json(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const before = read("status.json", {}), index = read("index.json", []), have = new Set(index.map(g => g.key));
  let token = null, base = null;
  try { token = (await json(`${IDENTITY}?key=${API_KEY}`, { method: "POST", headers: HEADERS, body: JSON.stringify({ returnSecureToken: true }) })).idToken; }
  catch (e) { fail("sign-in", e); }
  let lines = null;
  for (const db of token ? DBS : []) {
    try { lines = (await json(`${db}/crates/rooms/${INDEX_ROOM}/games.json?auth=${token}`, { headers: HEADERS })) || {}; base = db; break; }
    catch (e) { fail(`index at ${db}`, e); }
  }
  let found = 0;
  for (const [key, line] of Object.entries(lines || {})) {
    if (have.has(key) || !line?.room) continue;
    try {
      const branch = await json(`${base}/crates/rooms/${line.room}/dandan.json?auth=${token}`, { headers: HEADERS });
      if (!branch?.game) throw new Error("no game in the room");
      write(`games/${key}.json`, { key, room: line.room, line, game: branch.game, result: branch.result || line.result, players: branch.players });
      index.push({ key, room: line.room, uid: line.uid, ...(branch.result || line.result) });
      found++;
    } catch (e) { fail(`game ${key} in ${line.room}`, e); }
  }
  index.sort((a, b) => (a.ended || 0) - (b.ended || 0));
  // the folder changes (and so is committed) only when there is something new to say, so the branch isn't a log of idle hours
  const kept = new Set(index.map(g => g.key)), listed = Object.keys(lines || {});
  const status = { at: new Date().toISOString(), games: index.length, new: found, listed: listed.length, unread: listed.filter(k => !kept.has(k)).length, errors };
  if (found) write("index.json", index);
  if (found || !before.at || errors.join() !== (before.errors || []).join()) write("status.json", status);
  console.log(`${index.length} games, ${found} new, ${errors.length} problems`);
}
main().catch(e => { fail("run", e); write("status.json", { at: new Date().toISOString(), errors }); }).finally(() => { process.exitCode = 0; });
