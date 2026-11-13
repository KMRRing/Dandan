// The game lab's side of the game page (lab.html; dandan.js loads this only when lab.html has raised the flag, so index.html never
// runs a line of it). The game is the game: the same table, the same rules. What the lab adds:
//   1. the opponent: which engine Monte is (dandan-engines.js), seated through the page's own computer-player hooks (botCtx, the
//      engine id that goes with the look-ahead's request to the worker);
//   2. coaches: any number of engines, each shown or hidden, asked at each decision of yours (priority and the questions put to you); each
//      one's pick is ringed on the table (the page's ring set, the same rings a coach has always had), listed in a strip above your
//      hand, and when the shown coaches pick different moves the strip says so, in a line, never in a popup;
//   3. a sheet that describes each engine (how it was built, what to expect) beside the switches;
//   5. autoplay: an engine (the pilot) plays your moves for you until the shown coaches disagree, or the game ends; then it
//      stops and the decision is yours. Started and stopped from the strip; the pilot is chosen in the sheet;
//   4. flags: the ⚑ on a coach's pick marks it as one the player disagrees with. The flags go with the game's record (`how`), so
//      the game history lists them and opens the game at each;
//   6. the error review (12 November 2026, Korbi): positions where Monte's move was flagged as a possible error (error-review.json,
//      lab/error-review-data.mjs), each simulated again with every engine, and a verdict per position: an objective error, not an
//      error, or unsure. An objective error is a marker every future engine is checked against. The verdicts are kept on the
//      device and in the database (the index room's errors, which tools/pull-games.mjs collects as errors.json);
//   7. replays (12 November 2026, Korbi: "taken fully into the exact game replay"): any kept game played again on the lab's own table,
//      both hands face up, a move at a time; the coaches play each decision of either side, a play can be flagged as a possible
//      error, and at a flagged play the verdict is given there. Opened from the games page (Replay), the error review, or
//      lab.html?replay=<game key>&m=<moves made>. The lab's own game waits underneath.
// The choices are kept in localStorage under dandan-lab:lab, a lab game under dandan-lab:game (never the player's own saved
// game), and its flags under dandan-lab:flags. Lab games are recorded like any game, marked "lab · <engine>".
import { ENGINES, engineOf, DEFAULT_ENGINE, decide } from "./dandan-engines.js";
import { moveName } from "./dandan-words.js";
import { DECK } from "./dandan-cards.js";
import { nm } from "./dandan-core.js";
import { DEPTH } from "./dandan-think.js";
import { getSync } from "./net.js";
import { INDEX_ROOM } from "./records.js";
import { savedName } from "./name.js";
import { shownRules } from "./dandan-rules.js";
import { replay as replayGame } from "./records.js";
import { khSet, BOTH } from "./dandan-core.js";

const KEY = "dandan-lab:lab";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const $ = id => document.getElementById(id);

// ---------- what is kept ----------
/** The coach settings as they start: the two Mediums (a millisecond each) shown, no Hard coach (it takes a look-ahead of its own a decision). */
export const DEFAULTS = { engine: DEFAULT_ENGINE, coach: { "medium-tempo": true, "medium-squeeze": true }, hide: {}, coachDepth: "quick", oppDepth: "deepest", pilot: "medium-tempo", cover: true };
const DEPTH_WORDS = { quick: "Quick (64 deals)", long: "Long (256 deals)", deep: "Deep (1,024 deals)", deepest: "Deepest (2,048 deals, as the live game)" };
export function loadSettings(read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }) {
  const got = read() || {}, s = { ...DEFAULTS, ...got, coach: { ...(got.coach || DEFAULTS.coach) }, hide: { ...(got.hide || {}) } };
  if (!engineOf(s.engine)?.available) s.engine = DEFAULT_ENGINE;            // an engine that is gone or not built is not seated
  if (!DEPTH[s.oppDepth]) s.oppDepth = DEFAULTS.oppDepth;
  if (!DEPTH[s.coachDepth]) s.coachDepth = DEFAULTS.coachDepth;
  for (const id of Object.keys(s.coach)) if (!engineOf(id)?.available) delete s.coach[id];
  if (!engineOf(s.pilot)?.available) s.pilot = DEFAULTS.pilot;
  return s;
}
let settings = loadSettings();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ } };
if (globalThis.__dandanLab) globalThis.__dandanLab.engine = settings.engine;   // dandan.js reads the opponent from here

// ---------- flags: coach picks the player disagrees with ----------
const FLAGS = "dandan-lab:flags";
let flags = { game: null, list: [] };            // the flags of one game (by when it began)
try { flags = JSON.parse(localStorage.getItem(FLAGS)) || flags; } catch { /* private mode */ }
const flagsOf = v => (v?.G && flags.game === v.G.started ? flags.list : []);
/**
 * A flag: the decision (`at`, the moves made before it, as the history's slider counts them), the turn, the coach and its pick,
 * and what the other coaches picked. Pure: the tests read it.
 */
export function flagOf(v, e, p, others) {
  return { at: (v.G.moves || []).length, turn: v.state.turn, coach: e.id, name: e.name, pick: p.text,
    ...(p.chance == null ? {} : { chance: Math.round(p.chance * 1000) / 1000 }), others };
}
const sameFlag = (a, b) => a.at === b.at && a.coach === b.coach;
function toggleFlag(id) {
  const v = C.view(), e = engineOf(id), p = picks.get(id);
  if (!myNow(v) || !e || p?.status !== "done") return;
  const others = activeCoaches().filter(o => o.id !== id && picks.get(o.id)?.status === "done").map(o => `${o.short}: ${picks.get(o.id).text}`);
  const f = flagOf(v, e, p, others), list = flagsOf(v);
  flags = { game: v.G.started, list: list.some(x => sameFlag(x, f)) ? list.filter(x => !sameFlag(x, f)) : [...list, f] };
  try { localStorage.setItem(FLAGS, JSON.stringify(flags)); } catch { /* private mode */ }
  C.toast(flagsOf(v).some(x => sameFlag(x, f)) ? `Flagged: ${e.short} ${p.text}` : "Flag taken off");
  paintStrip();
  C.record?.();
}
const flagged = id => { const v = C?.view(); return !!v?.G && flagsOf(v).some(x => x.at === (v.G.moves || []).length && x.coach === id); };

/** What a lab game's record carries: the opponent, its depth, the coaches, and the flags (as one string: the database drops empty lists). */
export function how(v = C?.view()) {
  const e = engineOf(settings.engine), list = flagsOf(v);
  return { level: `lab · ${e?.name || settings.engine}`, think: settings.oppDepth, engine: settings.engine,
    coaches: activeCoaches().map(c => c.id).join(" "), ...(list.length ? { flags: JSON.stringify(list) } : {}) };
}

/** Whether Monte hides its timing tell (dandan.js, engine coverStop): on unless switched off here; a new game takes it up. */
export const coverOn = () => settings.cover !== false;

// ---------- the error review ----------
const VERDICTS = "dandan-lab:errors";
const VERDICT_WORDS = { error: "Objective error", fine: "Not an error", unsure: "Unsure" };
let review = null, reviewLoading = null;
const sims = new Map();                            // position id → { engine id → { status, text, chance } }
let verdicts = (() => { try { return JSON.parse(localStorage.getItem(VERDICTS)) || {}; } catch { return {}; } })();
function loadReview() {
  reviewLoading ||= fetch(new URL("./error-review.json", import.meta.url)).then(r => r.json()).then(d => { review = d; paintSheet(); C?.redraw(); }, () => { review = { items: [], failed: true }; paintSheet(); });
  return reviewLoading;
}
/** A verdict given: kept here and in the database, so the lab can read it back and every future engine be checked against it. */
async function setVerdict(id, v, flag = verdicts[id]?.flag) {
  verdicts = { ...verdicts, [id]: { verdict: v, at: Date.now(), ...(flag ? { flag } : {}) } };
  try { localStorage.setItem(VERDICTS, JSON.stringify(verdicts)); } catch { /* private mode */ }
  paintSheet();
  try {
    const sync = await getSync();
    await sync.update(`crates/rooms/${INDEX_ROOM}/errors`, { [id]: { verdict: v, at: Date.now(), uid: sync.uid || "", name: savedName() || "", ...(flag ? { flag } : {}) } });
    C?.toast(v === "flagged" ? "Flagged: it is in the error review" : `Marked: ${VERDICT_WORDS[v]}`);
  } catch (e) { C?.toast("Kept on this device; the database didn't take it: " + (e?.message || e)); }
}
/** Every engine plays the position again (Medium on this thread, Hard each in its own worker at the coaches' depth). */
function simulate(item) {
  const got = {};
  sims.set(item.id, got);
  for (const e of ENGINES.filter(x => x.available)) {
    got[e.id] = { status: "thinking" };
    const done = r => {
      got[e.id] = r.error || !r.result?.move ? { status: "error", text: r.error || "no move" }
        : { status: "done", text: moveName(r.result.move, item.state, item.seat) || "pass", chance: r.result.chance, same: JSON.stringify(r.result.move) === JSON.stringify(item.played) };
      paintSheet();
    };
    if (e.kind === "medium") decide(e, structuredClone(item.state), item.seat).then(result => done({ result }), err => done({ error: String(err?.message || err) }));
    else askCoach(e, structuredClone(item.state), item.seat).then(done);
  }
  paintSheet();
}
function reviewHtml() {
  if (!review) { loadReview(); return `<p class="lab-note">Loading the positions…</p>`; }
  if (review.failed || !review.items.length) return `<p class="lab-note">No positions to review.</p>`;
  const k = new URLSearchParams(location.search).get("k") || "";
  const names = s => s.map(id => nm(id)).join(", ") || "—";
  const bf = (st, seat) => st.bf.filter(p => p.ctl === seat).map(p => nm(p.id) + (p.tapped ? " (tapped)" : "")).join(", ") || "—";
  const done = review.items.filter(i => verdicts[i.id]).length;
  const extra = Object.entries(verdicts).filter(([id, v]) => v.flag && !review.items.some(i => i.id === id));
  return `<p class="lab-note">Positions where Monte's move was flagged as a possible error. Each can be played again by every engine (Simulate). Mark it an objective error, and every future engine is checked against it: playing the move again counts against that engine. ${done} of ${review.items.length} marked.</p>
    ${review.items.map(i => {
      const st = i.state, v = verdicts[i.id]?.verdict, sim = sims.get(i.id), stack = st.stack.map(x => x.name).join(" ← ");
      return `<details class="lab-eng lab-err${v ? " marked" : ""}"${sim ? " open" : ""}><summary><b>Turn ${i.turn}: Monte ${esc(moveName(i.played, st, i.seat) || "passes")}</b>${v ? ` · <em>${esc(VERDICT_WORDS[v])}</em>` : ""}</summary>
        <p class="lab-note">${esc(i.why)}.</p>
        <p class="lab-note">${esc(st.step)}${stack ? ` · stack: ${esc(stack)}` : ""} · life Monte ${st.life[1]}, you ${st.life[0]} · library ${st.lib.length}</p>
        <p class="lab-note"><b>Monte's hand:</b> ${esc(names(st.hand[1]))}<br><b>Your hand:</b> ${esc(names(st.hand[0]))}<br><b>Monte's side:</b> ${esc(bf(st, 1))}<br><b>Your side:</b> ${esc(bf(st, 0))}</p>
        <p class="lab-note"><b>Engines at ${i.deals || 256} deals:</b> ${Object.entries(i.engines).map(([n, m]) => `${esc(n)} ${esc(m)}`).join(" · ")}</p>
        ${sim ? `<p class="lab-note"><b>Simulated now:</b> ${Object.entries(sim).map(([id, r]) => `${esc(engineOf(id)?.short || id)}: ${r.status === "done" ? `${esc(r.text)}${r.chance != null ? ` (${Math.round(100 * r.chance)}%)` : ""}${r.same ? " ✓ same as Monte" : ""}` : r.status === "thinking" ? "thinking…" : esc(r.text)}`).join(" · ")}</p>` : ""}
        <div class="lab-row"><button type="button" class="btn primary" data-replay="${esc(i.game)}" data-m="${i.move}">Replay to here</button><button type="button" class="btn" data-sim="${esc(i.id)}">Simulate</button>
          <a class="btn" href="games.html?k=${encodeURIComponent(k)}&g=${esc(i.game)}&m=${i.move}" target="_blank" rel="noopener">Game viewer</a></div>
        <div class="lab-row">${Object.entries(VERDICT_WORDS).map(([key, w]) => `<button type="button" class="btn${v === key ? " primary" : ""}" data-verdict="${esc(i.id)}" data-v="${key}">${esc(w)}</button>`).join("")}</div>
      </details>`;
    }).join("")}
    ${extra.length ? `<h3 class="lab-h">Flagged in replays</h3>${extra.map(([id, v]) => `<div class="lab-eng lab-err"><b>Turn ${v.flag.turn}: ${esc(v.flag.who)} ${esc(v.flag.play)}</b>${v.verdict !== "flagged" ? ` · <em>${esc(VERDICT_WORDS[v.verdict] || v.verdict)}</em>` : " · <em>flagged</em>"}
      <div class="lab-row"><button type="button" class="btn primary" data-replay="${esc(v.flag.game)}" data-m="${v.flag.move}">Replay to here</button></div></div>`).join("")}` : ""}`;
}

// ---------- replays ----------
let RP = null;                                     // { key, game, names, at, total, view }
/** Once a value: the database answers a path's watch with what is there, then the watch is dropped. */
const once = (sync, path) => new Promise((res, rej) => { let off = null, done = false; off = sync.watch(path, v => { if (done) return; done = true; res(v); queueMicrotask(() => off?.()); }, rej); });
/** A kept game from the database: its index line's room, or the unfinished games' copy. */
async function fetchGame(key) {
  const sync = await getSync(), line = await once(sync, `crates/rooms/${INDEX_ROOM}/games/${key}`);
  if (line?.room) { const g = await once(sync, `crates/rooms/${line.room}/dandan/game`); if (g) return { game: g, name: line.name }; }
  const live = await once(sync, `crates/rooms/${INDEX_ROOM}/live/${key}`);
  if (live?.game) return { game: live.game, name: live.name };
  throw new Error("that game isn't kept");
}
/** The view of a replay at a move: the game as it stood, both hands face up. */
function replayView() {
  const G = replayGame(shownRules, RP.game, RP.at);
  if (G.error) throw new Error(`the moves stop making sense at move ${G.at + 1}: ${G.error}`);
  const state = JSON.parse(JSON.stringify(G.state));
  for (const seat of [0, 1]) for (const id of state.hand[seat]) khSet(state, id, BOTH);
  return { G: { ...G, seq: `replay:${RP.key}:${RP.at}` }, state, seat: 0, seats: [{ name: RP.names[0] }, { name: RP.names[1], bot: true }], toMove: state.over ? null : shownRules.toMove(state),
    over: !!state.over, mode: "replay", replay: true, me: null, code: "" };
}
async function startReplay(key, at = 0, given = null) {
  try {
    C.toast("Loading the game…", 1500);
    loadReview();
    const { game, name } = given || await fetchGame(key);
    const moves = typeof game.moves === "string" ? JSON.parse(game.moves) : game.moves || [];
    const names = [String(game.seats?.[0]?.name || name || "You"), String(game.seats?.[1]?.name || "Monte")];
    RP = { key, game, moves, names, total: moves.length, at: Math.max(0, Math.min(moves.length, at || 0)) };
    goTo(RP.at);
  } catch (e) { RP = null; C.toast("Couldn't replay that game: " + (e?.message || e), 4000); }
}
function goTo(at) {
  RP.at = Math.max(0, Math.min(RP.total, at));
  try { C.showReplay(replayView()); } catch (e) { C.toast(String(e?.message || e), 4000); }
}
function leaveReplay() { RP = null; C.showReplay(null); }
const playAt = () => RP.moves[RP.at];
/** The replay's controls, in the place of the game's buttons: back and on, the move made here, flagging it, the verdict. */
export function replayControls(box) {
  if (!RP) { box.innerHTML = ""; return; }
  const v = C.view(), s = v.state, next = playAt(), id = `${RP.key}-${RP.at}`, mark = verdicts[id];
  const who = next ? RP.names[next[0]] : "", play = next ? moveName(next[1], s, next[0]) || (next[1].t === "pass" ? "passes" : next[1].t) : "";
  const listed = review?.items.some(i => i.id === id);
  box.innerHTML = `<div class="lab-replay">
    <p class="lab-note"><b>Replay</b> · ${esc(RP.names[0])} vs ${esc(RP.names[1])} · move ${RP.at} of ${RP.total} · turn ${s.turn}${s.over ? " · over" : ""}</p>
    <div class="lab-row"><button type="button" class="btn" data-rp="-10">−10</button><button type="button" class="btn" data-rp="-1">◀</button><button type="button" class="btn primary" data-rp="1">▶</button><button type="button" class="btn" data-rp="10">+10</button><button type="button" class="btn" data-rp="leave">Back to my game</button></div>
    ${next ? `<p class="lab-note">Next: <b>${esc(who)} ${esc(play)}</b></p>` : `<p class="lab-note">The end of the game.</p>`}
    ${next ? `${mark || listed ? `<p class="lab-note">⚑ ${mark?.verdict && mark.verdict !== "flagged" ? `Marked: <b>${esc(VERDICT_WORDS[mark.verdict])}</b>` : "Flagged as a possible error: is it one?"}</p>
      <div class="lab-row">${Object.entries(VERDICT_WORDS).map(([k, w]) => `<button type="button" class="btn${mark?.verdict === k ? " primary" : ""}" data-rv="${k}">${esc(w)}</button>`).join("")}</div>`
      : `<div class="lab-row"><button type="button" class="btn" data-rv="flagged">⚑ Flag this play</button></div>`}` : ""}
  </div>`;
}
function replayClick(e) {
  if (!RP) return;
  const b = e.target.closest("[data-rp]"), r = e.target.closest("[data-rv]");
  if (b) { if (b.dataset.rp === "leave") leaveReplay(); else goTo(RP.at + Number(b.dataset.rp)); return; }
  if (r) {
    const next = playAt(), s = C.view().state, id = `${RP.key}-${RP.at}`;
    const flag = { game: RP.key, move: RP.at, turn: s.turn, seat: next[0], who: RP.names[next[0]], play: moveName(next[1], s, next[0]) || next[1].t };
    setVerdict(id, r.dataset.rv, flag).then(() => C.redraw());
  }
}

/** The engines that are coaching now: ticked as a coach and shown. */
export const activeCoaches = (st = settings) => ENGINES.filter(e => e.available && st.coach[e.id] && !st.hide[e.id]);
/** The engines asked at a decision: the shown coaches, and the pilot while autoplay runs (asked even when not a coach). */
const asked = () => { const a = activeCoaches(); return auto && !a.some(e => e.id === settings.pilot) ? [...a, engineOf(settings.pilot)] : a; };
let auto = false;                                  // autoplay running (never kept: a reload stops it)

// ---------- the opponent ----------
/** What the page's computer-player call is given: the Medium plan of the engine seated (Hard ignores it). */
export const botCtx = ctx => ({ ...ctx, style: engineOf(settings.engine)?.style || undefined, tune: engineOf(settings.engine)?.tune || undefined });

function seatOpponent() {
  const e = engineOf(settings.engine);
  C.opts.level = e.kind === "hard" ? "hard" : "medium";    // Hard's look-ahead runs in the worker; a Medium answers on the page's thread
  C.opts.think = settings.oppDepth;
  C.LAB.engine = e.id;
}

// ---------- a move, as rings on the table ----------
/**
 * The marks that show a move on the page (the keys its ring set is drawn from): "b:Label" a button, "c:id" a card in your hand,
 * "t:c:id" / "t:p:seat" / "t:s:sid" a permanent, a player, a spell on the stack, "o:…" a row of a question's sheet, "q:id" a card of
 * the order being chosen, "pile:yard" the graveyard. Pure: the tests read it.
 */
export function ringsOf(m, s, seat) {
  const out = [], hand = s.hand[seat] || [], sameName = id => hand.filter(h => DECK[h] === DECK[id]);
  const target = t => {
    if (t.k === "p") out.push(`t:p:${t.seat}`);
    else if (t.k === "s") out.push(`t:s:${t.sid}`);
    else if (t.k === "g") out.push("pile:yard");
    else out.push(`t:c:${t.id}`);
  };
  switch (m?.t) {
    case "pass": out.push("b:Pass"); break;
    case "land": case "cycle": for (const id of sameName(m.card)) out.push(`c:${id}`); break;
    case "cast":
      if (m.from === "yard") out.push("pile:yard"); else for (const id of sameName(m.card)) out.push(`c:${id}`);
      for (const t of m.targets || []) target(t);
      break;
    case "ability": out.push(`t:c:${m.id}`); break;
    case "keep": out.push("b:Keep"); break;
    case "mull": out.push("b:Mulligan"); break;
    case "bottom": case "discard": case "putback": for (const id of m.cards || []) out.push(`c:${id}`); break;
    case "attack": if (!(m.ids || []).length) out.push("b:No attack"); for (const id of m.ids || []) out.push(`t:c:${id}`); break;
    case "block": if (!(m.pairs || []).length) out.push("b:No blocks"); for (const [b, a] of m.pairs || []) out.push(`t:c:${b}`, `t:c:${a}`); break;
    case "order": for (const id of m.cards || []) out.push(`q:${id}`); break;
    case "surveil": out.push(m.yard ? "b:Graveyard" : "b:Keep on top"); break;
    case "owner": out.push(m.bottom ? "b:Bottom" : "b:Second from top"); break;
    case "search": out.push(m.card == null ? "o:none" : `o:${nm(m.card)}`); break;
    case "pick":
      if (s.pending?.for === "boil") out.push(`t:c:${m.card}`);
      else if (s.pending?.for === "drop") out.push(m.card == null ? "b:None" : `c:${m.card}`);
      else if (m.card != null) out.push("pile:yard");
      break;
    case "bend": out.push(`o:${m.from}`, `o:to:${m.to}`); break;
    case "name": out.push(`o:${m.name}`); break;
    case "retarget":
      if (!m.targets?.length) out.push("b:Keep the targets", "o:none");
      else { const t = m.targets[0], k = `${t.k}:${t.sid ?? t.id ?? t.seat}`; out.push(`t:${k}`, `o:t:${k}`); }
      break;
  }
  return out;
}

// ---------- when coaches differ ----------
/**
 * The line that tells the player their coaches disagree, or null when they all agree (or fewer than two have picked). `picks`:
 * [{ short, text }] by coach. Coaches that picked the same move are named together: "Hard + Tempo: pass · Squeeze: cast Dandân".
 * The moves are compared as the words that name them, so the same card in two copies, or two lists of one set of targets, are one move.
 */
export function disagreement(picks) {
  const by = new Map();
  for (const p of picks) { if (!by.has(p.text)) by.set(p.text, []); by.get(p.text).push(p.short); }
  if (by.size < 2) return null;
  return `Coaches disagree: ${[...by].map(([text, who]) => `${who.join(" + ")}: ${text}`).join(" · ")}`;
}

// ---------- the coaches, asked at each decision of yours ----------
let C = null;                                      // the page's hooks (dandan.js passes them to attach)
let key = "";                                      // the decision the coaches were asked for
const picks = new Map();                           // engine id → { status: thinking | done | error, move, text, chance, list, error }
const coachWorkers = new Map();                    // a Hard coach's own worker, so the opponent's move never waits behind a coach

const myNow = v => !!v?.G && !v.over && (v.replay ? v.toMove != null : v.seat != null && v.toMove === v.seat);

/** Asks a Hard coach's worker (the look-ahead off the page's thread, dandan-worker.js with an engine id). */
function askCoach(e, state, seatNo) {
  let wk = coachWorkers.get(e.id);
  if (!wk) {
    try {
      const w = new Worker(new URL("./dandan-worker.js", import.meta.url), { type: "module" });
      wk = { w, waiting: new Map(), n: 0 };
      w.onmessage = ev => { const f = wk.waiting.get(ev.data.id); wk.waiting.delete(ev.data.id); f?.(ev.data); };
      w.onerror = () => { for (const f of wk.waiting.values()) f({ error: "the worker would not start" }); wk.waiting.clear(); };
      coachWorkers.set(e.id, wk);
    } catch { return Promise.resolve({ error: "no worker in this browser" }); }
  }
  return new Promise(res => { const id = ++wk.n; wk.waiting.set(id, res); wk.w.postMessage({ id, kind: "think", state, seat: seatNo, depth: settings.coachDepth, engine: e.id }); });
}
/** A decision has passed: a look-ahead still running for it is dropped (its worker stopped), not waited for. */
function stopCoaches() {
  for (const [id, wk] of coachWorkers) if (wk.waiting.size) { wk.w.terminate(); for (const f of wk.waiting.values()) f({ error: "stopped" }); coachWorkers.delete(id); }
}

/** Called by the page with every view, before it draws: a new decision of yours asks the shown coaches; any other clears the rings. */
export function onView(v) {
  if (!C) return;
  autoOver(v);
  const k = myNow(v) ? `${v.G.seq}:${v.G.n}` : "";
  if (k === key) return;
  key = k;
  stopCoaches();
  picks.clear();
  C.rings.clear();
  if (k) ask(v, k);
  paintStrip();
}
function ask(v, k) {
  const state = v.state, seatNo = v.replay ? v.toMove : v.seat;
  for (const e of asked()) {
    picks.set(e.id, { status: "thinking" });
    const done = r => {
      if (key !== k) return;                                      // the decision has moved on
      if (r.error || !r.result?.move) picks.set(e.id, { status: "error", error: r.error || "no move" });
      else {
        const { move, chance, list } = r.result;
        picks.set(e.id, { status: "done", move, state, seat: seatNo, text: moveName(move, state, seatNo) || "pass", chance,
          list: (list || []).map(c => ({ text: moveName(c.move, state, seatNo) || "pass", mean: c.mean })) });
      }
      refresh();
    };
    if (e.kind === "medium") decide(e, structuredClone(state), seatNo).then(result => done({ result }), err => done({ error: String(err?.message || err) }));
    else askCoach(e, state, seatNo).then(done);
  }
}
/** The rings of the picks so far, the strip, and the table drawn again. */
function refresh() {
  C.rings.clear();
  for (const e of activeCoaches()) { const p = picks.get(e.id); if (p?.status === "done") for (const r of ringsOf(p.move, p.state, p.seat)) C.rings.add(r); }
  paintStrip();
  C.redraw();
  autoStep();
}

// ---------- autoplay ----------
/**
 * When every engine asked has answered: the shown coaches disagree, or one gave no answer, and autoplay stops at this decision;
 * otherwise the pilot's move is played (after a moment, so the move can be seen). Pure decision: the tests read it.
 */
export function autoVerdict(answers, pilot) {
  if (answers.some(a => a.status === "thinking")) return { wait: true };
  if (answers.some(a => a.status !== "done")) return { stop: "an engine gave no answer" };
  const p = answers.find(a => a.id === pilot);
  if (!p) return { stop: "the pilot gave no answer" };
  const coaches = answers.filter(a => a.coach);
  if (disagreement(coaches.map(a => ({ short: a.short, text: a.text })))) return { stop: "the coaches disagree" };
  if (coaches.length && coaches.some(a => a.text !== p.text)) return { stop: "a coach disagrees with the pilot" };
  return { move: p.move };
}
let autoKey = "";
function autoStep() {
  if (!auto || !key || autoKey === key) return;
  const coachIds = new Set(activeCoaches().map(e => e.id));
  const answers = asked().map(e => ({ id: e.id, short: e.short, coach: coachIds.has(e.id), ...(picks.get(e.id) || { status: "thinking" }) }));
  const v = autoVerdict(answers, settings.pilot);
  if (v.wait) return;
  autoKey = key;
  if (v.stop) { setAuto(false, `Autoplay stopped: ${v.stop}`); return; }
  const k = key;
  setTimeout(() => { if (auto && key === k) C.page.move(v.move); }, 350);
}
function setAuto(on, why) {
  auto = on; autoKey = "";
  if (why) C.toast(why);
  if (on) reask(); else paintStrip();
}
// the game over: autoplay has nothing left to do
function autoOver(v) { if (auto && v?.over) setAuto(false, "Autoplay stopped: the game is over"); }
/** A coach turned on, off, shown or hidden, or its depth changed: asked again for the decision now. */
function reask() {
  const v = C.view();
  key = "";
  onView(v);
  C.rings.clear();
  paintStrip();
  C.redraw();
}

// ---------- the strip above your hand ----------
const pct = c => (c == null ? "" : ` <i>${Math.round(c * 100)}%</i>`);
function paintStrip() {
  const box = $("labStrip"), coaches = activeCoaches();
  box.hidden = false;
  const pilot = engineOf(settings.pilot);
  const autoBtn = `<button type="button" class="lab-auto${auto ? " on" : ""}" data-auto="1" title="${auto ? "Stop autoplay" : `${esc(pilot?.name)} plays for you until the coaches disagree`}">${auto ? "■ Stop" : `▶ Auto: ${esc(pilot?.short || "")}`}</button>`;
  if (!coaches.length) { box.innerHTML = `<div class="lab-chips">${autoBtn}</div>`; return; }
  const mine = myNow(C.view());
  const chips = coaches.map(e => {
    const p = picks.get(e.id);
    const say = !mine ? "…" : !p || p.status === "thinking" ? "thinking…" : p.status === "error" ? "no answer" : `${esc(p.text)}${pct(p.chance)}`;
    const done = mine && p?.status === "done", on = done && !RP && flagged(e.id);
    return `<span class="lab-chip${done ? " done" : ""}${on ? " flagged" : ""}"><button type="button" class="lab-say" data-info="${e.id}" title="${esc(e.name)}: how it was built"><b>${esc(e.short)}</b> ${say}</button>${done && !RP ? `<button type="button" class="lab-flag" data-flag="${e.id}" aria-pressed="${on}" title="Flag this pick as one you disagree with">⚑</button>` : ""}</span>`;
  }).join("");
  const line = disagreement(coaches.map(e => ({ e, p: picks.get(e.id) })).filter(x => x.p?.status === "done").map(x => ({ short: x.e.short, text: x.p.text })));
  box.classList.toggle("split", !!line);
  box.innerHTML = `${line ? `<p class="lab-split">${esc(line)}</p>` : ""}<div class="lab-chips">${chips}${RP ? "" : autoBtn}</div>`;
}

// ---------- the sheet ----------
const openInfo = new Set();
const KIND = { medium: "Medium", hard: "Hard" };
function paintSheet() {
  const body = $("labBody"), top = body.scrollTop;
  const depth = (cur, keys) => keys.map(k => `<option value="${k}"${cur === k ? " selected" : ""}>${esc(DEPTH_WORDS[k])}</option>`).join("");
  const card = e => {
    const on = !!settings.coach[e.id], shown = e.available && !settings.hide[e.id], open = openInfo.has(e.id);
    return `<article class="lab-eng${e.available ? "" : " off"}" data-id="${e.id}">
      <button type="button" class="lab-name" data-info="${e.id}" aria-expanded="${open}"><b>${esc(e.name)}</b><span class="lab-kind">${KIND[e.kind]}${e.available ? "" : " · not built yet"}</span><i aria-hidden="true">${open ? "−" : "i"}</i></button>
      <div class="lab-ctl">
        <label><input type="radio" name="opp" value="${e.id}"${settings.engine === e.id ? " checked" : ""}${e.available ? "" : " disabled"}> Monte plays this</label>
        <label><input type="checkbox" data-coach="${e.id}"${on ? " checked" : ""}${e.available ? "" : " disabled"}> Coach</label>
        <label><input type="checkbox" data-show="${e.id}"${shown ? " checked" : ""}${e.available ? "" : " disabled"}> Show</label>
      </div>
      ${open ? `<div class="lab-desc"><p>${esc(e.description)}</p><p><b>What to expect.</b> ${esc(e.expect)}</p></div>` : ""}
    </article>`;
  };
  body.innerHTML = `<p class="lab-lead">The same game as the live one. Choose who Monte is, and who coaches you: at each decision of yours every shown coach's pick is ringed on the table and listed above your hand, and you are told when they differ. A hidden coach is not run. ▶ Auto lets the chosen engine play your moves until the shown coaches disagree. Tap ⚑ on a pick you disagree with: lab games are recorded (marked lab), flags and all, so the game history lists them. Tap a name to read how it was built.</p>
    ${ENGINES.map(card).join("")}
    <h3 class="lab-h">Error review</h3>
    ${reviewHtml()}
    <h3 class="lab-h">Thinking</h3>
    <label class="lab-sel">Monte's look-ahead <select data-depth="oppDepth">${depth(settings.oppDepth, ["quick", "long", "deep", "deepest"])}</select></label>
    <label class="lab-sel">Autoplay: who plays for you <select data-pilot="1">${ENGINES.filter(e => e.available).map(e => `<option value="${e.id}"${settings.pilot === e.id ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label>
    <label class="lab-sel">Hard coaches' look-ahead <select data-depth="coachDepth">${depth(settings.coachDepth, ["quick", "long", "deep"])}</select></label>
    <label class="lab-sel"><input type="checkbox" data-cover="1"${settings.cover !== false ? " checked" : ""}> Hide Monte's timing tell</label>
    <p class="lab-note">On, Monte stops and takes its time wherever a card you can't see could have had it act, so how fast it passes shows nothing. Off, it passes at once where it has nothing to do: quicker games, but its speed gives its hand away. A new game takes the setting up; switched off mid-game, its passes there come at once.</p>
    <p class="lab-note">Deals are the guesses of the hidden cards a look-ahead plays each move out over; more take longer and judge better. A Hard coach thinks in its own worker, so the table never stops for it.</p>`;
  body.scrollTop = top;
}
function openSheet(info) {
  if (info) openInfo.add(info);
  paintSheet();
  if (!$("labDlg").open) $("labDlg").showModal();
  if (info) $("labBody").querySelector(`.lab-eng[data-id="${info}"]`)?.scrollIntoView({ block: "nearest" });
}
function wireSheet() {
  $("labBtn").addEventListener("click", () => openSheet());
  $("labClose").addEventListener("click", () => $("labDlg").close());
  $("labDlg").addEventListener("click", e => { if (e.target === $("labDlg")) $("labDlg").close(); });   // a tap outside the sheet
  $("labStrip").addEventListener("click", e => {
    if (e.target.closest("[data-auto]")) return setAuto(!auto, auto ? "Autoplay stopped" : null);
    const f = e.target.closest("[data-flag]");
    if (f) return toggleFlag(f.dataset.flag);
    const b = e.target.closest("[data-info]");
    if (b) openSheet(b.dataset.info);
  });
  $("labBody").addEventListener("click", e => {
    const sim = e.target.closest("button[data-sim]");
    if (sim) { const it = review?.items.find(i => i.id === sim.dataset.sim); if (it) simulate(it); return; }
    const rb = e.target.closest("button[data-replay]");
    if (rb) { $("labDlg").close(); startReplay(rb.dataset.replay, Number(rb.dataset.m)); return; }
    const ver = e.target.closest("button[data-verdict]");
    if (ver) { setVerdict(ver.dataset.verdict, ver.dataset.v); return; }
    const b = e.target.closest("button[data-info]");
    if (!b) return;
    const id = b.dataset.info;
    if (openInfo.has(id)) openInfo.delete(id); else openInfo.add(id);
    paintSheet();
  });
  $("labBody").addEventListener("change", e => {
    const t = e.target;
    if (t.name === "opp") { settings.engine = t.value; seatOpponent(); save(); C.forgetBot(); C.toast(`Monte is now ${engineOf(t.value).name}`); }
    else if (t.dataset.coach) { settings.coach[t.dataset.coach] = t.checked; save(); reask(); }
    else if (t.dataset.show) { settings.hide[t.dataset.show] = !t.checked; save(); reask(); }
    else if (t.dataset.cover) { settings.cover = t.checked; save(); C.toast(t.checked ? "Monte hides its timing tell from the next game" : "Monte's timing tell is no longer hidden"); }
    else if (t.dataset.pilot) { settings.pilot = t.value; save(); if (auto) reask(); else paintStrip(); }
    else if (t.dataset.depth) {
      settings[t.dataset.depth] = t.value; save();
      if (t.dataset.depth === "oppDepth") seatOpponent(); else reask();
    }
    paintSheet();
  });
}

// ---------- joining the page ----------
/** Called once by dandan.js when its table is up: ctx is { LAB, opts, toast, redraw, rings, view, myDecision, page, forgetBot, record }. */
export function attach(ctx) {
  C = ctx;
  $("controls").addEventListener("click", replayClick);
  // a game record handed in directly (the tests, or a game not in the database): window.__dandanReplay(record, at)
  globalThis.__dandanReplay = (game, at = 0, key = "local") => startReplay(key, at, { game, name: "" });
  { const q = new URLSearchParams(location.search), key = q.get("replay"); if (key) { loadReview(); startReplay(key, Number(q.get("m")) || 0); } }
  seatOpponent();
  wireSheet();
  onView(C.view());
  paintStrip();
  C.redraw();
}
