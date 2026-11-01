// tools/pull-games.mjs against a stand-in for the database: it signs in, reads the index room, fetches each game it hasn't got,
// and writes the games, the index and the status; a second run fetches nothing it has; a game that can't be read is said
// and the rest still come; a database that refuses it is said and nothing is lost.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { INDEX_ROOM } from "../records.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };

const db = { index: {}, rooms: {}, asked: [], refuse: false, signedIn: 0 };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x"), send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "POST" && url.pathname === "/signup") { db.signedIn++; return send(db.refuse ? 400 : 200, db.refuse ? { error: { message: "ADMIN_ONLY_OPERATION" } } : { idToken: "tok" }); }
  if (url.searchParams.get("auth") !== "tok") return send(401, { error: "Permission denied" });
  db.asked.push(url.pathname);
  const m = url.pathname.match(/^\/crates\/rooms\/([A-Z]{4})(\/games|\/dandan)?\.json$/);
  if (!m) return send(404, null);
  if (m[1] === INDEX_ROOM && m[2] === "/games") return send(200, Object.keys(db.index).length ? db.index : null);
  if (m[2] === "/dandan") return send(200, db.rooms[m[1]] ?? null);
  send(200, null);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const run = out => new Promise(r => execFile("node", ["tools/pull-games.mjs", out], { env: { ...process.env, IDENTITY_URL: `http://127.0.0.1:${port}/signup`, DB_URL: `http://127.0.0.1:${port}` } }, (e, stdout, stderr) => r({ code: e ? e.code : 0, stdout, stderr })));
const game = (key, name, won) => ({ line: { room: [...key].map(d => String.fromCharCode(65 + +d)).join(""), at: +key, name, uid: "u1", result: { name, won, started: +key, ended: +key + 1000, moves: 5 } }, branch: { game: { seed: 1, seats: 2, moves: "[[0,{\"t\":\"pass\"}]]", state: { log: [] } }, result: { name, won, started: +key, ended: +key + 1000, moves: 5 }, players: { u1: { name } } } });
const put = (key, name, won) => { const g = game(key, name, won); db.index[key] = g.line; db.rooms[g.line.room] = g.branch; return g.line.room; };

const out = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
const a = put("1000", "Tom", true), b = put("2000", "Ann", false);
let r = await run(out);
{
  const files = fs.existsSync(path.join(out, "games")) ? fs.readdirSync(path.join(out, "games")).sort() : [];
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")), status = JSON.parse(fs.readFileSync(path.join(out, "status.json"), "utf8"));
  const one = JSON.parse(fs.readFileSync(path.join(out, "games", "1000.json"), "utf8"));
  check(r.code === 0 && files.join() === "1000.json,2000.json", "it signs in, reads the index and keeps each game under its key");
  check(index.length === 2 && index[0].name === "Tom" && index[0].room === a && index[1].won === false && index[0].uid === "u1", "the index has each game's summary and the room it was in, oldest first");
  check(one.game.moves === "[[0,{\"t\":\"pass\"}]]" && one.line.room === a && one.players.u1.name === "Tom", "a game keeps what the room had: the game with its moves, the summary and who played");
  check(status.games === 2 && status.new === 2 && status.errors.length === 0 && status.unread === 0, "the status says how many it has and that nothing went wrong");
}
// a second run asks for no game it has, and a new one is added
db.asked.length = 0;
const c = put("3000", "Tom", false);
r = await run(out);
{
  const rooms = db.asked.filter(p => p.endsWith("/dandan.json"));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  check(rooms.length === 1 && rooms[0] === `/crates/rooms/${c}/dandan.json` && index.length === 3, "a second run fetches only the game it hasn't got");
}
// nothing new: nothing written (so the branch isn't a log of idle hours)
{
  const before = fs.statSync(path.join(out, "status.json")).mtimeMs;
  await new Promise(r => setTimeout(r, 30));
  r = await run(out);
  check(fs.statSync(path.join(out, "status.json")).mtimeMs === before && /3 games, 0 new/.test(r.stdout), "with nothing new it writes nothing");
}
// a game that can't be read is said, and the others still come
{
  put("4000", "Ann", true);
  const dead = "5000"; db.index[dead] = { room: "ZZZZ", at: 5000, name: "Bob", result: { name: "Bob" } };       // its room is gone
  put("6000", "Tom", true);
  r = await run(out);
  const status = JSON.parse(fs.readFileSync(path.join(out, "status.json"), "utf8")), index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  check(index.length === 5 && !index.some(g => g.name === "Bob") && status.errors.length === 1 && /5000 in ZZZZ/.test(status.errors[0]) && status.unread === 1, "a game whose room is gone is said, and the games after it still come");
  // it is tried again, and found once its room is there
  db.rooms.ZZZZ = game("5000", "Bob", true).branch;
  r = await run(out);
  const after = JSON.parse(fs.readFileSync(path.join(out, "status.json"), "utf8"));
  check(JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")).length === 6 && after.errors.length === 0 && after.unread === 0, "and it is fetched on a later run, once its room is there");
}
// a database that won't sign us in: said, nothing lost
{
  const before = fs.readFileSync(path.join(out, "index.json"), "utf8");
  db.refuse = true;
  r = await run(out);
  const status = JSON.parse(fs.readFileSync(path.join(out, "status.json"), "utf8"));
  check(r.code === 0 && status.errors.length === 1 && /sign-in/.test(status.errors[0]) && fs.readFileSync(path.join(out, "index.json"), "utf8") === before, "a refused sign-in is said in the status and the games already kept stay");
  db.refuse = false;
}
// an empty database (no game yet): a status, no error
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
  db.index = {}; db.rooms = {};
  r = await run(empty);
  const status = JSON.parse(fs.readFileSync(path.join(empty, "status.json"), "utf8"));
  check(status.games === 0 && status.errors.length === 0 && !fs.existsSync(path.join(empty, "index.json")), "with no game yet the first run still says so, and has no error");
}
server.close();
if (bad) { console.log(`${bad} problems`); process.exit(1); }
console.log("pull-games: games collected once each under their keys, a game it can't read is said, nothing kept is lost");
