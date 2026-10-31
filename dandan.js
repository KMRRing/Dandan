// Dandan: the communal-deck game of Forgetful Fish, played against the computer. The rules are dandan-engine.js's, the
// cards dandan-cards.js's and dandan-spells.js's, the computer player dandan-bot.js's (Hard's look-ahead,
// dandan-think.js, runs in dandan-worker.js so the table never stops while it thinks), the running seats.js's (solo,
// through seats-ui.js). This page draws the table: the other player's side across the top, the library, the turn and
// the graveyard between, yours below, then your hand and the buttons; in 3D, the battlefield seen at an angle. A card is
// read by pointing at it or tapping it; what it can do now is a button, and a spell that needs a target lights the
// legal ones on the table. A finished game's result goes to the database (results.js).
import { rules } from "./dandan-rules.js";
import { moves, afterFetch, bottomFor, payment, MOST_MULLS } from "./dandan-engine.js";
import { CARDS, DECK, HALVES, NAMES, BASICS, costWords, total, parseCost } from "./dandan-cards.js";
import { nm, defOf, perm, pt, isLand, isCreature, manaAlts, payFrom, topKnown, needType, poolOf, knownIn, knOf, typesOf } from "./dandan-core.js";
import { same } from "./dandan-spells.js";
import { seatPage, fillNames } from "./seats-ui.js";
import { part, choice, action } from "./menu.js";
import { savedName, askName } from "./name.js";
import { recordResult } from "./results.js";
import { sextant } from "./loading.js";
import { createTable3d } from "./dandan-3d.js";
import { curveOf, worthDrawing, hasActions, byTurn, momentsOf, linesBetween, MIN_FALL, captionOf, readoutOf, chartSvg, pointAt, BOX } from "./dandan-advantage.js";

const $ = id => document.getElementById(id);
const OPTS = "dandan:opts";
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// the computer's pace: how long what it does stays on the table before its next move, or until you tap
const PACES = [["slow", "3 s"], ["tap", "Tap to continue"]];
const SHOWN_MS = { slow: 3000 };
// What is fixed here (the Almanac's Dandan lets you choose): the computer plays Hard, thinking as long as it can (the
// deepest search, 4,096 deals a move), there is no coach, revealed cards are not marked (you remember them), the table
// is always seen in 3D, and always full screen. Only the two switches at the top and the computer's pace are the player's.
const saved = read(OPTS, {});
let opts = { level: "hard", think: "deepest", coach: "off", reveals: false, full: true, view: "3d",
  hold: !!saved.hold, manual: !!saved.manual, pace: PACES.some(([k]) => k === saved.pace) ? saved.pace : "slow" };
// Show revealed cards: never. Nothing marks what you have seen of the other hand or of the library (the cards known
// there, the top card when it is known): you have to remember
const sees = () => false;
let table3d = null;                                // the 3D view, once the page is wired (the foot of this file)
const in3d = () => !!table3d;
const saveOpts = () => write(OPTS, { hold: opts.hold, manual: opts.manual, pace: opts.pace });

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), ms);
}

// ---------- words ----------
/** A card's name short enough for a small card; the full name is on its detail and in the log. */
const SHORT = {
  "Narset's Reversal": "Reversal", "Izzet Boilerworks": "Izzet", "Mystic Sanctuary": "Sanctuary", "Mystic Retrieval": "Retrieval",
  "Lórien Revealed": "Lórien", "Halimar Depths": "Halimar", "Thundering Falls": "Falls", "Lonely Sandbar": "Sandbar", "Chart a Course": "Chart",
  "Deem Inferior": "Deem", "Take Inventory": "Inventory", "Gone Missing": "Missing", "Memory Lapse": "Lapse", "Piracy Charm": "Charm",
  "Commit // Memory": "Commit", "Flood Plain": "Flood Plain", "Remote Isle": "Remote Isle",
};
/** Where a long name may break on a small card (a soft hyphen shows only when the line does break). */
const SOFT = { Brainstorm: "Brain­storm", Inventory: "Inven­tory", Sanctuary: "Sanc­tuary", Retrieval: "Retrie­val", Reversal: "Rever­sal", Missing: "Miss­ing", Repulse: "Re­pulse", Halimar: "Hali­mar", Sandbar: "Sand­bar" };
const short = name => SHORT[name] || name;
const LAND_CODE = { "Flood Plain": "Fld", "Halimar Depths": "Hal", "Izzet Boilerworks": "Izz", "Lonely Sandbar": "Sbr", "Mystic Sanctuary": "Sct", "Remote Isle": "Rem", "Thundering Falls": "Fls" };
const STEP_WORDS = { upkeep: "upkeep", draw: "draw", main1: "main phase", attackers: "attack", blockers: "blocks", damage: "combat", main2: "second main", end: "end step" };
const MODE_WORDS = ["Islandwalk", "+2/−1", "Discard"];
const STACK_WORDS = { "@fetch": "Flood Plain’s search", "@isle": "Islandcycling", "@cycle": "Cycling", "@clue": "Clue", "@dandan": "Dandân sacrificed",
  "@depths": "Halimar Depths", "@falls": "Thundering Falls", "@boil": "Izzet Boilerworks", "@sanct": "Mystic Sanctuary" };
const TYPE_WORDS = { land: "Land", creature: "Creature", instant: "Instant", sorcery: "Sorcery", token: "Token" };
const TYPE_ORDER = { land: 0, creature: 1, instant: 2, sorcery: 3 };

/** A cost as mana pips: generic in grey, blue and red in their colours. */
function pips(cost) {
  const out = [...String(cost || "").matchAll(/\{(\w)\}/g)].map(([, x]) => `<i class="dd-pip ${/\d/.test(x) ? "g" : x}">${x}</i>`).join("");
  return out ? `<span class="dd-pips" aria-label="cost ${esc(costWords(cost))}">${out}</span>` : "";
}

let V = null;                                      // the view on screen
let page = null;                                   // set once the runner is up
const S = () => V?.state;
const nameOf = seat => V?.seats?.[seat]?.name ?? (seat === 0 ? "You" : "Monte");
const isMe = seat => V?.seat != null && seat === V.seat;
const IRREGULAR = { has: "have", is: "are", fetches: "fetch" };
/** A log line in words: the seats named, and when the viewer's name is the stock "You" the grammar follows it. */
function words(text) {
  const t = fillNames(text, V.seats);
  if (V.seat == null || V.seats[V.seat]?.name !== "You") return t;
  return t.replace(/\bYou's\b/g, "Your").replace(/\bYou ([a-z]+)\b/g, (m, verb) => `You ${IRREGULAR[verb] || (verb.endsWith("s") ? verb.slice(0, -1) : verb)}`);
}

// ---------- what's on screen, apart from the game: the pick being made ----------
const blank = () => ({ look: null, arm: null, tap: null, picks: [], atk: [], blk: [], blkSel: null, order: [], bend: null, dlgOff: false, yard: false });
let ui = blank(), uiKey = "", gameSeen = 0;
let hover = null;                                  // the card a mouse or pen is on, read below your side (a finger taps instead)
const POINTER = matchMedia("(hover: hover)").matches;
let MV = [];                                       // the moves the viewer could make now (every card once)
// the cards in your hand a Flood Plain's Island would pay for (name → the Flood Plain), worked out once a decision; and
// the card a "Fetch first" was for, read again with its Cast button once the Island is in
let FETCH = new Map(), fetchKey = "", fetchFor = null;
let CARD = null, CARD_GO = [];                     // the card in its sheet ({ id }), and the sheet's buttons


// ---------- the look-ahead off this thread: Hard's moves ----------
// A worker (dandan-worker.js) works out the computer's move, so the table never stops while it thinks. A browser with no
// worker plays at the runner's own pace and depth (the computer's move on this thread).
const workers = {};
function botWorker() {
  if (workers.bot === undefined) {
    try {
      const w = new Worker(new URL("./dandan-worker.js", import.meta.url), { type: "module" });
      const waiting = new Map();
      w.onmessage = e => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data); };
      w.onerror = () => { workers.bot = false; for (const f of waiting.values()) f({ error: "no worker" }); waiting.clear(); };
      workers.bot = { w, waiting, n: 0 };
    } catch { workers.bot = false; }
  }
  return workers.bot;
}
/** The computer's move, from the look-ahead at the deepest search. */
function askMove(state, seat) {
  const wk = botWorker();
  if (!wk) return Promise.resolve({ error: "no worker" });
  return new Promise(res => { const id = ++wk.n; wk.waiting.set(id, res); wk.w.postMessage({ id, kind: "move", state, seat, depth: opts.think }); });
}
/** A position's key: the state as the runner hands it to the computer (FNV-1a of its JSON). */
function keyOf(state) {
  const str = JSON.stringify(state);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${h}:${str.length}`;
}
// Hard's moves, worked out in the worker while the runner is held: the runner asks rules.bot as usual and gets the
// move from here at once (the same move it would work out itself: the look-ahead stops at so many deals, not a time)
const botMoves = new Map();
let botAsked = "";
function holdForBot() {
  if (!page || opts.level !== "hard") return false;
  const v = page.view;
  if (!v.G || v.over || v.mode !== "solo" || v.toMove == null || !v.seats[v.toMove]?.bot) return false;
  const key = keyOf(v.state);
  if (botMoves.has(key) || workers.bot === false) return false;
  if (botAsked !== key) {
    botAsked = key;
    askMove(v.state, v.toMove).then(({ move, error }) => {
      if (move) { botMoves.set(key, move); if (botMoves.size > 40) botMoves.delete(botMoves.keys().next().value); }
      else if (error) { console.warn("dandan: the worker's move failed", error); workers.bot = false; }
      page.runner.kick();
    });
  }
  return true;
}
const pageRules = { ...rules, bot: (s, seat, ctx) => (ctx.level === "hard" && botMoves.get(keyOf(s))) || rules.bot(s, seat, ctx) };
// ---------- the computer's pace ----------
// What the computer does stays on the table a while before its next move (1.5 s, 3 s), or until you tap Continue
// (solo); Quick is the runner's own pace. A move of yours, and what follows from it at once, needs no waiting: you made
// it. A turn's first line marks the turn and isn't something done.
// fresh: the newest thing done (n counts them, ln is the log's last line read), when it came, whether your own move did
// it; tapped: the n Continue was last tapped at
let fresh = { game: 0, ln: 0, n: 0, at: 0, mine: true }, tapped = 0;
function noteFresh(prev, v) {
  const s = v.state;
  if (!s) return;
  const ln = s.ln || 0;
  if (v.G.seq !== fresh.game) { fresh = { game: v.G.seq, ln, n: 0, at: 0, mine: true }; tapped = 0; return; }
  if (ln <= fresh.ln) return;
  if (!s.log.some(e => e.n > fresh.ln && !/^Turn \d+:/.test(e.t))) { fresh.ln = ln; return; }
  const mine = !!prev?.G && prev.G.seq === v.G.seq && prev.seat != null && prev.toMove === prev.seat;
  fresh = { game: v.G.seq, ln, n: fresh.n + 1, at: Date.now(), mine };
}
const BASE_PACE = () => (opts.level === "hard" ? 450 : 1000);
/**
 * How long the computer's next move waits: Quick, the runner's pace; else what it last did stays its while, and a move
 * of its that showed nothing (a pass) doesn't hold up the next, which is the one to see.
 */
function paceNow() {
  const ms = SHOWN_MS[opts.pace];
  return ms && !fresh.mine ? Math.max(250, fresh.at + ms - Date.now()) : BASE_PACE();
}
/** Tap to continue: the computer's next move waits, after something it did, until Continue. */
const tapHold = () => opts.pace === "tap" && !!V?.G && V.mode === "solo" && !V.over && V.toMove != null
  && !!V.seats[V.toMove]?.bot && !fresh.mine && fresh.n > tapped;
function goOn() {
  tapped = fresh.n;
  draw();
  page.runner.kick();
}

page = seatPage({
  rules: pageRules, id: "dandan", pace: paceNow, botName: () => "Monte", level: () => opts.level, name: savedName() || "You",
  // Hard works its move out while a tap is awaited, so it comes the moment you tap
  hold: () => { const thinking = holdForBot(); return tapHold() || thinking; },
  onView: v => {
    noteFresh(V, v);
    V = v;
    const key = v.G ? `${v.G.seq}:${v.G.n}` : "";
    if (key !== uiKey) {
      // a move was made: the picks it was for are over, and the card sheet opened for them; a card being read in the
      // middle stays up while it's still there
      const look = ui.look;
      ui = blank();
      uiKey = key;
      // (in 3D the card read stands over the table: there it goes once the card has gone somewhere else, played or cast)
      const at = look && v.state ? placeOf(v.state, look.id) : "";
      if (at && (!in3d() || at === look.at)) ui.look = look;
      closeCard();
    }
    draw();
  },
  onOver, toast,
});

const decisionOf = v => `${v.G.seq}:${v.G.n}`;
/** Whether the decision now is yours: priority, or a question put to you. */
const myDecision = () => !!V?.G && V.seat != null && !V.over && V.toMove === V.seat;
const RING = new Set();                            // no coach to ring its move: the table's drawing keeps the hook

// ---------- the table, drawn ----------
const canAct = () => V?.G && V.seat != null && !S().over && !S().pending && S().prio === V.seat;

function draw() {
  if (!page) return;
  const v = V;
  document.body.classList.toggle("dd-watch", !!v?.G && v.seat == null);
  if (!v?.G) {
    if (in3d()) table3d.empty();
    else {
      for (const id of ["foe", "mid", "me", "hand", "log"]) $(id).replaceChildren();
      $("read").innerHTML = `<p class="dd-lead">One deck of eighty cards, one library, one graveyard, shared. Win with Dandâns, which can only attack across an Island.</p>`;
    }
    $("controls").innerHTML = `<button class="btn primary dd-go" type="button" data-act="new">New game</button>`;
    return;
  }
  const s = S(), me = v.seat ?? 0;
  if (v.G.seq !== gameSeen) { gameSeen = v.G.seq; hover = null; }
  MV = canAct() ? moves(s, v.seat) : [];
  if (!canAct()) FETCH = new Map();
  else if (fetchKey !== decisionOf(v)) { fetchKey = decisionOf(v); FETCH = afterFetch(s, v.seat); }
  if (fetchFor && (fetchFor.game !== v.G.seq || fetchFor.turn !== s.turn || !s.hand[me].includes(fetchFor.id))) fetchFor = null;
  if (fetchFor && MV.some(m => m.t === "cast" && m.from === "hand" && DECK[m.card] === DECK[fetchFor.id])) { ui.look = { id: fetchFor.id, at: "hand" }; fetchFor = null; }
  const q = question();
  if (in3d()) table3d.draw(q);
  else {
    drawZone($("foe"), 1 - me, q);
    drawStrip();
    drawZone($("me"), me, q);
    drawRead(q);
    drawHand(q);
    drawLog();
  }
  drawControls(q);
  syncDialogs(q);
}

// ---------- the two sides ----------
const targetKey = t => `${t.k}:${t.sid ?? t.id ?? t.seat}`;
const armedKeys = () => new Set((ui.arm?.moves || []).map(m => targetKey(m.targets[0])));

function drawZone(box, seat, q) {
  const s = S(), armed = armedKeys();
  const mine = s.bf.filter(p => p.ctl === seat);
  const cre = mine.filter(isCreature), lnd = mine.filter(isLand), tok = mine.filter(p => !isLand(p) && !isCreature(p));
  const untapped = lnd.filter(p => !p.tapped).length;
  const turn = s.active === seat && !s.over && s.step !== "mull";
  const them = seat !== (V.seat ?? 0);
  // what you know is in their hand (seen going there), and mana floating in a pool until the step ends
  const known = them && V.seat != null && sees() ? knownIn(s, seat, V.seat).length : 0, pool = poolOf(s, seat);
  box.className = `dd-zone ${them ? "foe" : "me"}${turn ? " turn" : ""}${V.toMove === seat ? " move" : ""}`;
  box.innerHTML = `<header class="dd-zh${armed.has(`p:${seat}`) ? " tgt" : ""}${RING.has(`t:p:${seat}`) ? " advised" : ""}" data-tk="p:${seat}"${them ? ' data-act="known"' : ""}>
      <b class="dd-who">${esc(nameOf(seat))}</b>
      <span class="dd-meta">${them ? `hand ${s.hand[seat].length}${known ? `, ${known} known` : ""} · ` : ""}${untapped} of ${lnd.length} lands ready${pool ? ` · <b class="dd-float">${pool.split("").map(c => `<i class="dd-pip ${c === "U" || c === "R" ? c : "g"}">${c}</i>`).join("")} floating</b>` : ""}</span>
      <span class="dd-life" aria-label="${s.life[seat]} life">${s.life[seat]}</span></header>
    <div class="dd-cres">${cre.map(p => creTile(p, q, armed)).join("")}</div>
    <div class="dd-lands">${[...lnd, ...tok].sort(landOrder).map(p => landChip(p, armed)).join("")}</div>`;
}
const landOrder = (a, b) => (nm(a.id) === "Clue") - (nm(b.id) === "Clue") || (nm(a.id) === "Island" ? 0 : 1) - (nm(b.id) === "Island" ? 0 : 1) || a.id - b.id;

/** A Dandân: its power and toughness as they stand, and what's been done to it. */
function creTile(p, q, armed) {
  const s = S(), [a, b] = pt(p), base = defOf(p.id).pt;
  const att = s.combat?.att.includes(p.id), pairs = s.combat?.blk || [];
  const link = pairs.findIndex(([x, y]) => x === p.id || y === p.id);
  const mineBlk = ui.blk.findIndex(([x, y]) => x === p.id || y === p.id);
  const pending = q?.pick;
  const can = (pending === "attack" && S().pending.ids.includes(p.id)) || (pending === "block" && (S().pending.blockers.includes(p.id) || S().pending.attackers.includes(p.id)));
  const chosen = ui.atk.includes(p.id) || ui.blkSel === p.id;
  const tags = [att ? "attacking" : "", p.tapped && !att ? "tapped" : "", p.walk ? "islandwalk" : "", needType(p) !== "Island" ? `wants ${needType(p)}` : "", p.ent >= s.turn && p.ctl === s.active ? "new" : ""].filter(Boolean);
  const num = link >= 0 ? link + 1 : mineBlk >= 0 ? mineBlk + 1 : 0;
  return `<button type="button" class="dd-cre${p.tapped ? " tapped" : ""}${att ? " att" : ""}${can ? " can" : ""}${chosen ? " sel" : ""}${armed.has(`c:${p.id}`) ? " tgt" : ""}${ui.look?.id === p.id ? " look" : ""}${RING.has(`t:c:${p.id}`) ? " advised" : ""}" data-perm="${p.id}" data-tk="c:${p.id}" aria-label="Dandân ${a} ${b}${tags.length ? `, ${tags.join(", ")}` : ""}">
    <span class="dd-pt"><b class="${a !== base[0] ? "chg" : ""}">${a}</b>/<b class="${b !== base[1] ? "chg" : ""}">${b}</b></span>
    <span class="dd-cn">Dandân</span><span class="dd-tags">${tags.map(esc).join(" · ")}</span>${num ? `<i class="dd-link">${num}</i>` : ""}</button>`;
}

/** A land (or a Clue): its mana, tapped or not; a basic Island is only its colour, the rest carry a short name. */
function landChip(p, armed) {
  const clue = nm(p.id) === "Clue", alts = clue ? [] : manaAlts(p), cols = [...new Set(alts.flat())];
  const basic = nm(p.id) === "Island" && !p.tc;
  const mana = alts.map(a => a.join("")).join("/");
  const text = clue ? "Clue" : basic ? "U" : LAND_CODE[nm(p.id)] || mana;
  const cls = clue ? "dd-clue" : cols.length > 1 ? "duo" : cols.length ? `m${cols[0]}` : "m0";
  return `<button type="button" class="dd-land ${cls}${p.tapped ? " tapped" : ""}${p.tc ? " bent" : ""}${armed.has(`c:${p.id}`) ? " tgt" : ""}${ui.tap ? (ui.tap.ids.includes(p.id) ? " pay" : payable(p) ? " can" : "") : ""}${ui.look?.id === p.id ? " look" : ""}${RING.has(`t:c:${p.id}`) ? " advised" : ""}" data-perm="${p.id}" data-tk="c:${p.id}" aria-label="${esc(nm(p.id))}${p.tapped ? ", tapped" : ""}${ui.tap?.ids.includes(p.id) ? ", chosen to tap" : ""}">${esc(text)}</button>`;
}

// ---------- between the two sides: the library, the turn and who's to move, the graveyard ----------
function waitLine() {
  const s = S(), tm = V.toMove;
  if (s.over || tm == null) return "";
  if (V.seat == null) return `${nameOf(tm)} to move`;
  if (tm === V.seat) return s.pending ? "Your answer" : s.stack.length ? "Your priority: answer, or let it resolve" : "Your move";
  if (tapHold()) return `${esc(nameOf(tm))} waits for your tap`;
  return `${sextant().outerHTML}${esc(nameOf(tm))} is ${s.pending ? "choosing" : "thinking"}`;
}
function headline() {
  const s = S();
  if (s.over) return s.winner < 0 ? "A drawn game" : isMe(s.winner) ? "You won" : `${nameOf(s.winner)} won`;
  if (s.step === "mull") return "Opening hands";
  return `Turn ${s.turn} · ${isMe(s.active) ? "your" : `${esc(nameOf(s.active))}’s`} ${STEP_WORDS[s.step] || s.step}`;
}
/** A stack item's name and what it's aimed at. */
function itemWords(it) {
  const tw = t => (t.k === "s" ? stackName(S().stack.find(x => x.sid === t.sid)) : t.k === "p" ? nameOf(t.seat) : t.k === "g" ? nm(t.id) : nm(t.id));
  const to = it.targets.map(tw).filter(Boolean).join(", ");
  return { name: stackName(it), to };
}
const stackName = it => (it ? STACK_WORDS[it.name] || it.name : "a spell");

function drawStrip() {
  const s = S(), lib = s.lib.length, known = sees() ? topKnown(s, V.seat ?? 0) : null;
  $("mid").innerHTML = `<button type="button" class="dd-pile" data-act="lib" aria-label="Library, ${lib} cards"><b>${lib}</b><small class="${known != null ? "known" : ""}">${known != null ? `▲ ${esc(short(nm(known)))}` : "Library"}</small></button>
    <div class="dd-phase"><b>${headline()}</b><span class="dd-wait">${waitLine()}</span></div>
    <button type="button" class="dd-pile${RING.has("pile:yard") ? " advised" : ""}" data-act="yard" aria-label="Graveyard, ${s.yard.length} cards"><b>${s.yard.length}</b><small>Graveyard</small></button>`;
}

// ---------- below your side: the card read, and what has happened ----------
// The left column: the question put to you or the target being chosen, then the stack, then the card read: the one
// tapped (the buttons below act on it), else the one a mouse or pen is on, else the stack's top (what's being cast, in
// full). The right: the log.
/** What's said above the stack: the question put to you, the target being chosen, or how the game ended (both views). */
function readHead(q = question()) {
  const s = S();
  return q ? q.say
    : ui.tap ? `<p class="dd-q">${esc(ui.tap.label)}: tap the lands to pay with</p><p class="dd-sub">It costs ${pips(costText(ui.tap.cost))}: ${ui.tap.ids.length} chosen${tapDone() ? "" : ", not enough yet"}.</p>`
    : ui.arm ? `<p class="dd-q">${esc(ui.arm.label)}: choose ${ui.arm.moves[0].targets[0].k === "p" ? "a player" : ui.arm.moves[0].targets[0].k === "g" ? "a card in the graveyard" : "a target"}</p><p class="dd-sub">The lit ones are legal.</p>`
    : s.over ? `<p class="dd-q">${esc(words(s.log[s.log.length - 1]?.t || ""))}</p>` : "";
}
function drawRead(q = question()) {
  const s = S(), armed = armedKeys(), head = readHead(q);
  const stack = s.stack.length ? `<div class="dd-stack" aria-label="The stack, the last cast on top">${[...s.stack].reverse().map(it => {
    const w = itemWords(it);
    return `<button type="button" class="dd-st ${isMe(it.ctl) ? "mine" : "theirs"}${armed.has(`s:${it.sid}`) ? " tgt" : ""}${RING.has(`t:s:${it.sid}`) ? " advised" : ""}" data-tk="s:${it.sid}" data-sid="${it.sid}">
      <b>${esc(w.name)}</b><span>${esc(nameOf(it.ctl))}${w.to ? ` → ${esc(w.to)}` : ""}</span></button>`;
  }).join("")}</div>` : "";
  const top = s.stack[s.stack.length - 1], id = q || ui.arm ? null : ui.look?.id ?? hover ?? top?.card ?? top?.src ?? null;
  const card = id != null ? detail(id) : head || stack ? "" : `<p class="dd-sub">${POINTER ? "Point at a card to read it here." : "Tap a card to read it here."}</p>`;
  $("read").innerHTML = head + stack + card;
}
/** The card a pointer or a tap is on: in the hand, on the table, on the stack, named in a line. */
function cardAt(el) {
  const c = el.closest?.("[data-card], [data-perm], [data-sid], [data-look], [data-qc]");
  if (!c) return null;
  if (c.dataset.sid != null) { const it = S()?.stack.find(x => x.sid === Number(c.dataset.sid)); return it?.card ?? it?.src ?? null; }
  const n = Number(c.dataset.card ?? c.dataset.perm ?? c.dataset.look ?? c.dataset.qc);
  return Number.isInteger(n) ? n : null;
}
$("app").addEventListener("pointerover", e => {
  if (e.pointerType === "touch" || !V?.G) return;
  const id = cardAt(e.target);
  if (id == null || id === hover) return;
  hover = id;
  if (in3d()) table3d.read(); else drawRead();
});

/** A card's type line in words. */
const typeLine = d => (d.type === "creature" ? `Creature · ${d.pt[0]}/${d.pt[1]} Fish` : d.type === "land" ? (d.subs.length ? `Land — ${d.subs.join(" ")}` : "Land") : TYPE_WORDS[d.type] + (d.aftermath ? " · aftermath" : ""));
/** What's been done to a permanent on the table. */
function stateWords(p) {
  return [p.tapped ? "Tapped" : "Untapped", isCreature(p) && p.ent >= S().turn && p.ctl === S().active ? "came this turn" : "", p.walk ? "has islandwalk" : "",
    ...(p.tc || []).map(([a, b]) => `its text now says ${b} for ${a}`), p.pump ? `${p.pump[0] >= 0 ? "+" : ""}${p.pump[0]}/${p.pump[1] >= 0 ? "+" : ""}${p.pump[1]} this turn` : "",
    `under ${isMe(p.ctl) ? "your" : `${nameOf(p.ctl)}’s`} control`].filter(Boolean).join(" · ");
}
/** A card's name as a chip that opens it. */
const chip = id => `<button type="button" class="dd-chip dd-name" data-look="${id}">${esc(nm(id))}</button>`;
/** A card read in full: the halves of a split card, the text in our words, and what's been done to it on the table. */
function detail(id) {
  const full = nm(id), p = perm(S(), id);
  return (HALVES[full] || [full]).map(h => {
    const d = CARDS[h];
    return `<div class="dd-detail"><div class="dd-dh"><b>${esc(h)}</b>${pips(d.cost)}</div><div class="dd-dt">${esc(typeLine(d))}</div><p>${esc(d.text)}</p></div>`;
  }).join("") + (p ? `<p class="dd-state">${esc(stateWords(p))}</p>` : "");
}

// ---------- your hand ----------
/** A hand in the order it's held: lands, the Dandân, instants, sorceries, each by cost (both views). */
const handOrder = hand => [...hand].sort((a, b) => TYPE_ORDER[defOf(a).type] - TYPE_ORDER[defOf(b).type] || total(parseCost(defOf(a).cost)) - total(parseCost(defOf(b).cost)) || a - b);
function drawHand(q) {
  const box = $("hand"), s = S();
  box.className = "dd-hand";
  if (V.seat == null) { box.innerHTML = `<p class="dd-watching">Watching: you sit down at the next game.</p>`; return; }
  const ids = handOrder(s.hand[V.seat]);
  const usable = new Set(MV.filter(m => m.from !== "yard").map(m => DECK[m.card]));
  box.dataset.n = ids.length;
  box.className = `dd-hand${canAct() ? " act" : ""}`;
  box.innerHTML = ids.map(id => {
    const d = defOf(id), pick = ui.picks.indexOf(id);
    return `<button type="button" class="dd-card ${d.type}${usable.has(DECK[id]) ? " can" : FETCH.has(DECK[id]) ? " fetch" : ""}${ui.look?.id === id ? " look" : ""}${pick >= 0 ? " sel" : ""}${RING.has(`c:${id}`) ? " advised" : ""}" data-card="${id}" aria-label="${esc(DECK[id])}">
      ${pips(d.cost)}<span class="dd-cn">${esc(SOFT[short(DECK[id])] || short(DECK[id]))}</span><span class="dd-ct">${TYPE_WORDS[d.type]}</span>${pick >= 0 ? `<i class="dd-link">${q?.ordered ? pick + 1 : "✓"}</i>` : ""}</button>`;
  }).join("");
}

function drawLog() {
  const box = $("log");
  box.innerHTML = S().log.map(e => `<li>${esc(words(e.t))}</li>`).join("");
  box.scrollTop = box.scrollHeight;
}

// ---------- the questions put to you ----------
/**
 * Your pending question as the page asks it: { say (html for the middle), buttons, pick (a choice made on the table or in
 * the hand), ordered, dlg ({ title, html, choices }: a list to choose from, in a sheet) }.
 */
function question() {
  const s = S(), q = s.pending, me = V.seat;
  if (!q || q.seat !== me) return null;
  const send = m => act(m);
  const say = (t, sub = "") => `<p class="dd-q">${t}</p>${sub ? `<p class="dd-sub">${sub}</p>` : ""}`;
  const picked = ui.picks.length;
  switch (q.t) {
    case "mull": {
      const shown = s.reveal && s.reveal.seat !== me ? `<p class="dd-sub">${esc(nameOf(s.reveal.seat))} showed ${s.reveal.cards.map(chip).join(" ")} and took a free mulligan.</p>` : "";
      // the first mulligan is free, and so is one of a hand short of lands or spells (shown); bottomFor counts the rest
      const put = bottomFor(q.taken), next = bottomFor(q.taken + 1);
      const why = q.free ? "Fewer than two lands or two spells: a free mulligan, and the hand is shown."
        : q.first ? "The first mulligan is free." : put ? `Keep it and put ${put} on the bottom; another mulligan, ${next}.` : "The free mulligan is taken: another puts one on the bottom.";
      return {
        say: say("Keep this hand?", `${why} Tap a card to read it.`) + shown,
        buttons: [
          { label: "Mulligan", sub: q.free ? "free · shown" : next ? `bottom ${next}` : "free", off: s.mull.n[me] >= MOST_MULLS && !q.free, fn: () => send({ t: "mull" }) },
          { label: "Keep", kind: "primary", sub: put ? `bottom ${put}` : "", fn: () => send({ t: "keep" }) }],
      };
    }
    case "bottom": return handPick(q, "bottom", `Put ${q.n} on the bottom of the library`, "Tap a card to read it and put it away.", "Bottom", { t: "bottom", cards: ui.picks });
    case "discard": return handPick(q, "discard", `Discard ${q.n === 1 ? "a card" : `${q.n} cards`}`, q.why ? `${q.why}.` : "", "Discard", { t: "discard", cards: ui.picks });
    case "putback": return {
      ...handPick(q, "putback", `Put ${q.n} back on top of the library`, q.n > 1 ? "The first you choose goes on top, the second under it." : "", "Put back", { t: "putback", cards: ui.picks }), ordered: true,
    };
    case "attack": return {
      pick: "attack", say: say("Attack?", "Tap the Dandâns that attack. One that is blocked trades with its blocker: 4 damage each way, and both die."),
      buttons: [
        { label: "No attack", fn: () => send({ t: "attack", ids: [] }) },
        { label: ui.atk.length ? `Attack with ${ui.atk.length}` : "Attack", kind: "primary", off: !ui.atk.length, fn: () => send({ t: "attack", ids: ui.atk }) }],
    };
    case "block": return {
      pick: "block", say: say(`${esc(nameOf(s.active))} attacks with ${q.attackers.length}`, "Tap one of your Dandâns, then the attacker it blocks. Tap a paired one to take it off."),
      buttons: [
        { label: "No blocks", fn: () => send({ t: "block", pairs: [] }) },
        { label: ui.blk.length ? `Block with ${ui.blk.length}` : "Block", kind: "primary", off: !ui.blk.length, fn: () => send({ t: "block", pairs: ui.blk }) }],
    };
    case "order": {
      const ids = q.cards, chosen = ui.order;
      return {
        say: say("Order the top of the library", "Tap each to read it and put it next, from the top down.") + `<div class="dd-chips">${ids.map(id => `<button type="button" class="dd-chip${chosen.includes(id) ? " sel" : ""}${RING.has(`q:${id}`) ? " advised" : ""}" data-qc="${id}">${chosen.includes(id) ? `<i>${chosen.indexOf(id) + 1}</i>` : ""}${esc(nm(id))}</button>`).join("")}</div>`,
        buttons: [
          { label: "Keep order", fn: () => send({ t: "order", cards: ids }) },
          { label: "Set order", kind: "primary", off: chosen.length !== ids.length, fn: () => send({ t: "order", cards: chosen }) }],
      };
    }
    case "surveil": return {
      say: say("Surveil 1", `The top card is ${chip(q.card)}. Keep it there, or put it in the graveyard?`),
      buttons: [{ label: "Graveyard", fn: () => send({ t: "surveil", yard: true }) }, { label: "Keep on top", kind: "primary", fn: () => send({ t: "surveil", yard: false }) }],
    };
    case "owner": return {
      say: say(`${chip(q.target)} goes into the library`, "As its owner you choose where."),
      buttons: [{ label: "Bottom", fn: () => send({ t: "owner", bottom: true }) }, { label: "Second from top", kind: "primary", fn: () => send({ t: "owner", bottom: false }) }],
    };
    default: return dialogQuestion(q, send, say);
  }
}
/** A choice of cards from the hand (bottom, discard, put back): tapped in the hand, then confirmed. */
function handPick(q, pick, title, sub, label, move) {
  return {
    pick, n: q.n, say: `<p class="dd-q">${esc(title)}</p>${sub ? `<p class="dd-sub">${esc(sub)}</p>` : ""}`,
    buttons: [{ label, sub: `${ui.picks.length} of ${q.n}`, kind: "primary", off: ui.picks.length !== q.n, fn: () => act(move) }],
  };
}

/** The questions with a list to choose from open in a sheet over the table (and come back from its button if it's closed). */
function dialogQuestion(q, send, say) {
  const s = S(), group = ids => {
    const by = new Map();
    for (const id of ids) { const k = nm(id); if (!by.has(k)) by.set(k, []); by.get(k).push(id); }
    return [...by];
  };
  const list = (rows, none) => ({ rows, none });
  switch (q.t) {
    case "search": {
      const rows = group(q.ids).map(([name, ids]) => ({ label: name, sub: ids.length > 1 ? `× ${ids.length}` : "", card: ids[0], ring: `o:${name}`, fn: () => send({ t: "search", card: ids[0] }) }));
      return { say: say(q.to === "bf" ? "Fetch a land" : "Find an Island"), buttons: [reopen()], dlg: { title: q.to === "bf" ? "Fetch a land" : "Find an Island", ...list(rows, { label: "Find nothing", ring: "o:none", fn: () => send({ t: "search", card: null }) }) } };
    }
    case "pick": {
      if (q.for === "boil") {
        const rows = q.ids.map(id => { const p = perm(s, id); return { label: nm(id), sub: p?.tapped ? "tapped" : "untapped", card: id, ring: `o:id:${id}`, fn: () => send({ t: "pick", card: id }) }; });
        return { say: say("Return a land you control to your hand"), buttons: [reopen()], dlg: { title: "Return a land to your hand", ...list(rows) } };
      }
      const title = q.for === "drop" ? "Put a creature or land from your hand onto the battlefield" : "Put an instant or sorcery from the graveyard on top of the library";
      const rows = group(q.ids).map(([name, ids]) => ({ label: name, sub: ids.length > 1 ? `× ${ids.length}` : "", card: ids[0], ring: `o:${name}`, fn: () => send({ t: "pick", card: ids[0] }) }));
      return { say: say(title), buttons: [reopen()], dlg: { title, ...list(rows, q.optional ? { label: "None", ring: "o:none", fn: () => send({ t: "pick", card: null }) } : null) } };
    }
    case "bend": {
      const p = perm(s, q.target), from = q.froms.length === 1 ? q.froms[0] : ui.bend;
      const title = `Mind Bend: ${nm(q.target)}`, rows = [];
      if (q.froms.length > 1) rows.push({ head: "Change which land type?" }, ...q.froms.map(f => ({ label: f, on: f === from, ring: `o:${f}`, fn: () => { ui.bend = f; draw(); } })));
      if (from) rows.push({ head: `${from} becomes` }, ...BASICS.filter(t => t !== from).map(t => ({ label: t, ring: `o:to:${t}`, fn: () => send({ t: "bend", from, to: t }) })));
      const note = nm(q.target) === "Dandân" ? "Its text will name the new type in place of Island: it attacks only a player who controls one, and it is sacrificed when its controller has none."
        : p && isLand(p) ? "Wherever the land’s text names the type, it names the new one, for good: an Island turned into a Swamp no longer counts as an Island." : "";
      return { say: say(title), buttons: [reopen()], dlg: { title, note, rows } };
    }
    case "name": {
      const seen = new Map();
      for (const id of [...s.hand[V.seat], ...s.yard, ...s.exile, ...s.bf.map(p => p.id), ...s.stack.map(i => i.card).filter(c => c != null)]) { const k = DECK[id]; if (k) seen.set(k, (seen.get(k) || 0) + 1); }
      const rows = NAMES.map(n => ({ label: n, sub: `${DECK.filter(x => x === n).length - (seen.get(n) || 0)} unseen`, card: DECK.indexOf(n), ring: `o:${n}`, fn: () => send({ t: "name", name: n }) }));
      return { say: say("Name a card"), buttons: [reopen()], dlg: { title: "Name a card", note: "Unseen: not in your hand, the graveyard, exile or on the table. Those are in the library or the other hand.", rows, cols: true } };
    }
    case "retarget": {
      // the Reversal resolving is a target too: a copied counter aimed at it does nothing
      const self = q.sid, labels = q.options.map(o => (o[0].k === "s" && o[0].sid === self ? "Narset’s Reversal itself: the copy does nothing" : o.map(tword).join(", "))), seen = {};
      const rows = q.options.map((o, i) => ({ label: labels.filter(l => l === labels[i]).length > 1 ? `${labels[i]} · ${(seen[labels[i]] = (seen[labels[i]] || 0) + 1)}` : labels[i], ring: `o:t:${targetKey(o[0])}`, fn: () => send({ t: "retarget", targets: o }) }));
      return { say: say("Choose new targets for the copy"), buttons: [reopen()], dlg: { title: "New target for the copy", ...list(rows, { label: "Keep the targets", ring: "o:none", fn: () => send({ t: "retarget" }) }) } };
    }
  }
  return null;
}
const reopen = () => ({ label: "Answer", sub: "reopen the question", kind: "primary", fn: () => { ui.dlgOff = false; draw(); } });
/** A target in words. */
function tword(t) {
  const s = S();
  if (t.k === "s") return stackName(s.stack.find(x => x.sid === t.sid));
  if (t.k === "p") return nameOf(t.seat);
  const p = perm(s, t.id);
  return p && !isLand(p) && nm(t.id) !== "Clue" ? `${nm(t.id)} (${isMe(p.ctl) ? "yours" : "theirs"})` : p ? `${nm(t.id)} (${isMe(p.ctl) ? "yours" : "theirs"})` : nm(t.id);
}

// ---------- the buttons ----------
let BTN = [];                                      // this draw's buttons, by position (the page's data-b)
function drawControls(q) {
  const box = $("controls"), s = S();
  if (V.seat == null) { box.innerHTML = `<p class="dd-status">${s.over ? headline() : "Watching"}</p>`; BTN = []; return; }
  let list = [];
  if (s.over) list = [{ label: "The result", kind: "primary", fn: () => showEnd(V) }, ...(page.host ? [{ label: "New game", fn: newGame }] : [])];
  else if (q) list = q.buttons;
  else if (ui.tap) list = [
    { label: "Cancel", fn: () => { ui.tap = null; draw(); } },
    { label: "Pay", sub: tapDone() ? `${ui.tap.ids.length} tapped` : "choose more", kind: "primary", off: !tapDone(), fn: () => act({ ...ui.tap.move, taps: ui.tap.ids }) }];
  else if (ui.arm) list = [{ label: "Cancel", fn: () => { ui.arm = null; closeView(); draw(); } }];
  else if (canAct()) {
    list = lookActions();
    list.push({ label: "Pass", sub: passWords(), kind: list.length ? "" : "primary", fn: () => act({ t: "pass" }) });
  }
  else if (tapHold()) list = [{ label: "Continue", sub: "their next move", kind: "primary", fn: goOn }];
  else list = [{ label: "Wait", sub: s.pending ? "their choice" : "their move", off: true, fn: () => {} }];
  BTN = list;
  box.dataset.n = list.length;
  // the coach's move, ringed on the button that makes it
  const ringed = b => [...RING].some(k => k.startsWith("b:") && (b.label === k.slice(2) || b.label.startsWith(`${k.slice(2)} `)));
  box.innerHTML = list.map((b, i) => `<button type="button" class="btn dd-btn${b.kind === "primary" ? " primary" : ""}${ringed(b) ? " advised" : ""}" data-b="${i}" ${b.off ? "disabled" : ""}><b>${esc(b.label)}</b>${b.sub ? `<small>${b.sub}</small>` : ""}</button>`).join("");
}
function passWords() {
  const s = S();
  if (s.stack.length) return "let it resolve";
  if (s.step === "upkeep") return isMe(s.active) ? "to your draw" : "let them draw";
  return { main1: "move on", attackers: "no change", blockers: "no change", main2: "to the end step", end: "end turn" }[s.step] || "";
}

/** The buttons for the card or permanent being read: what it can do now. */
function lookActions() {
  const id = ui.look?.id;
  if (id == null) return [];
  const out = [];
  const inHand = S().hand[V.seat].includes(id);
  if (inHand) {
    const name = DECK[id], mine = MV.filter(m => m.from !== "yard" && DECK[m.card] === name);
    const land = mine.find(m => m.t === "land");
    if (land) out.push({ label: "Play", sub: "land", fn: () => act({ ...land, card: id }) });
    const casts = mine.filter(m => m.t === "cast"), modes = [...new Set(casts.map(m => m.mode ?? 0))];
    for (const mode of modes) {
      const cands = casts.filter(m => (m.mode ?? 0) === mode).map(m => ({ ...m, card: id }));
      const label = modes.length > 1 ? MODE_WORDS[mode] : "Cast";
      out.push({ label, sub: pips(defOf(id).cost), fn: () => cast(cands, modes.length > 1 ? `${nm(id)}: ${MODE_WORDS[mode]}` : nm(id)) });
    }
    const cyc = mine.find(m => m.t === "cycle");
    if (cyc) out.push({ label: "Cycle", sub: esc(costWords(defOf(id).cycling)), fn: () => act({ ...cyc, card: id }) });
    // its mana only after a Flood Plain's fetch (which resolves first): the fetch, and the card read again once it's in
    if (!out.length && FETCH.has(name)) out.push({ label: "Fetch first", sub: "an Island, to pay", fn: () => { fetchFor = { id, game: V.G.seq, turn: S().turn }; act({ t: "ability", id: FETCH.get(name) }); } });
  } else {
    const ab = MV.find(m => m.t === "ability" && m.id === id);
    if (ab) out.push({ label: nm(id) === "Clue" ? "Crack" : "Fetch", sub: nm(id) === "Clue" ? "2 · draw" : "sacrifice", fn: () => act(ab) });
  }
  return out;
}

/** A spell ready to cast: with one possible target (or none) it goes at once; with several, the table lights them to choose from. */
function cast(cands, label) {
  if (cands.length === 1) { act(cands[0]); return; }
  ui.arm = { moves: cands, label };
  if (cands[0].targets[0].k === "g") openYard();
  draw();
}

/** A cost ({ g, U, R }) as the text pips draw. */
const costText = c => (c.g ? `{${c.g}}` : "") + "{U}".repeat(c.U) + "{R}".repeat(c.R);
/** Which lands are alike for tapping: the same card, bent the same way. */
const landKind = p => nm(p.id) + (p.tc ? JSON.stringify(p.tc) : "");
const payable = p => p.ctl === V.seat && !p.tapped && isLand(p) && manaAlts(p).length > 0;
/**
 * The manual tap (23 October 2026, Korbi: "when I have multiple different lands, there should be a 'manual tap' mode
 * where I select what lands will be tapped": an Izzet Boilerworks should be bouncing a tapped land): with the menu's
 * switch on, a move that costs mana, where the lands you could tap differ and some would stay out of it, waits for you to
 * choose them. It starts from the lands the game would tap, so one tap of Pay does as before.
 */
function tapStart(m) {
  if (!opts.manual || V.seat == null || !["cast", "cycle", "ability"].includes(m.t)) return null;
  const s = S(), pay = payment(s, V.seat, m);
  if (!pay || !pay.plan.taps.length) return null;
  const free = s.bf.filter(payable);
  if (new Set(free.map(landKind)).size < 2 || free.length <= pay.plan.taps.length) return null;
  const label = m.t === "cast" ? `Cast ${nm(m.card)}` : m.t === "cycle" ? `Cycle ${nm(m.card)}` : "Crack a Clue";
  return { move: m, cost: pay.cost, ids: [...pay.plan.taps], label };
}
/** A land tapped in or out of the choice (anything else is read as usual). */
function tapPick(id) {
  const p = perm(S(), id);
  if (!p || !payable(p)) { look(id); return; }
  const t = ui.tap;
  t.ids = t.ids.includes(id) ? t.ids.filter(x => x !== id) : [...t.ids, id];
  draw();
}
const tapDone = () => ui.tap && !!payFrom(S(), V.seat, ui.tap.cost, ui.tap.ids);
async function act(m) {
  if (!m.taps && !ui.tap) {
    const t = tapStart(m);
    if (t) { ui.tap = t; ui.look = null; closeView(); draw(); return; }
  }
  // holding priority keeps it after a spell or ability goes on the stack, to answer it yourself (fetch a land to shuffle, cycle another card to draw first); a cycled card always does (Korbi, 23 October 2026), and the game moves on where there is nothing you could do
  const hold = m.t === "cycle" || (opts.hold && (m.t === "cast" || m.t === "ability"));
  const why = await page.move(hold ? { ...m, hold: true } : m);
  if (why) { toast(why); return; }
  closeView();
}

// ---------- taps ----------
$("controls").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.dataset.act === "new") { newGame(); return; }
  BTN[Number(b.dataset.b)]?.fn();
});
/** A tap on the table, in either view: they mark their cards, piles and players alike. */
function boardTap(e) {
  const el = e.target.closest("button, [data-tk]");
  if (!el) return;
  if (el.dataset.act === "yard") { openYard(); return; }
  if (el.dataset.act === "lib") { openLibrary(); return; }
  if (el.dataset.act === "log") { openLog(); return; }
  if (el.dataset.act === "unlook") { ui.look = null; draw(); return; }
  if (el.dataset.look) { openCard(Number(el.dataset.look)); return; }
  if (el.dataset.qc) { openCard(Number(el.dataset.qc)); return; }
  const tk = el.dataset.tk;
  if (ui.arm && tk) {
    const hit = ui.arm.moves.find(m => targetKey(m.targets[0]) === tk);
    if (hit) act(hit);
    else toast("That isn’t a legal target");
    return;
  }
  if (el.dataset.perm != null) { permTap(Number(el.dataset.perm)); return; }
  if (el.dataset.sid) { const it = S().stack.find(x => x.sid === Number(el.dataset.sid)); if (it) look(it.card ?? it.src); return; }
  if (el.dataset.act === "known") openLibrary();
}
$("board").addEventListener("click", boardTap);
$("board3d").addEventListener("click", boardTap);
$("hand").addEventListener("click", e => {
  const b = e.target.closest("[data-card]");
  if (b) cardTap(Number(b.dataset.card));
});

/** A card read: in the middle of the table when that's free, else (a question or a target being chosen holds it) in a sheet over it. */
function look(id) {
  if (id == null) return;
  if (question() || ui.arm || ui.tap) { openCard(id); return; }
  ui.look = ui.look?.id === id ? null : { id, at: placeOf(S(), id) };
  draw();
}
/** Where a card read is: on the table or in your hand (else nowhere it's read from). */
const placeOf = (s, id) => (s?.bf.some(p => p.id === id) ? "bf" : s?.hand[V?.seat ?? 0]?.includes(id) ? "hand" : "");
function cardTap(id) {
  // a question up (the mulligan, a card to put away): the card is read in its sheet, and chosen there
  if (question()) { openCard(id); return; }
  // a second tap on a card with exactly one thing to do does it
  if (ui.look?.id === id && canAct()) {
    const a = lookActions();
    if (a.length === 1) { a[0].fn(); return; }
  }
  look(id);
}
function permTap(id) {
  const q = question(), p = perm(S(), id);
  if (!p) return;
  if (ui.tap) { tapPick(id); return; }
  if (q?.pick === "attack") {
    if (!S().pending.ids.includes(id)) { look(id); return; }
    ui.atk = ui.atk.includes(id) ? ui.atk.filter(x => x !== id) : [...ui.atk, id];
    draw();
    return;
  }
  if (q?.pick === "block") {
    const pend = S().pending;
    if (pend.blockers.includes(id)) {
      if (ui.blk.some(([b]) => b === id)) ui.blk = ui.blk.filter(([b]) => b !== id);
      else ui.blkSel = ui.blkSel === id ? null : id;
    } else if (pend.attackers.includes(id) && ui.blkSel != null) {
      ui.blk = [...ui.blk.filter(([b]) => b !== ui.blkSel), [ui.blkSel, id]];
      ui.blkSel = null;
    } else look(id);
    draw();
    return;
  }
  look(id);
}
/** A pick made from a card's sheet: in or out of the hand's picks (bottom, discard, put back), or the order of the top cards. */
function pickTap(id) {
  const q = question();
  if (q?.pick && ["bottom", "discard", "putback"].includes(q.pick)) {
    const i = ui.picks.indexOf(id);
    if (i >= 0) ui.picks.splice(i, 1);
    else if (q.n === 1) ui.picks = [id];
    else if (ui.picks.length < q.n) ui.picks.push(id);
  } else if (S().pending?.t === "order") ui.order = ui.order.includes(id) ? ui.order.filter(x => x !== id) : [...ui.order, id];
  closeCard();
  draw();
}

// ---------- a card read in full, in a sheet ----------
function openCard(id) {
  if (id == null || !Number.isInteger(id)) return;
  CARD = { id };
  fillCard();
  if (!$("cardDlg").open) $("cardDlg").showModal();
}
function closeCard() { CARD = null; if ($("cardDlg").open) $("cardDlg").close(); }
/** What the card's sheet offers to do with it: the question's pick, when the card is one it picks among. */
function cardActs(id) {
  const s = S(), q = question();
  if (!q) return [];
  if (q.pick && ["bottom", "discard", "putback"].includes(q.pick) && s.hand[V.seat].includes(id)) {
    const at = ui.picks.indexOf(id);
    if (at >= 0) return [{ label: q.pick === "putback" ? "Take it back" : "Keep it", fn: () => pickTap(id) }];
    const full = q.n > 1 && ui.picks.length >= q.n;
    const label = q.pick === "bottom" ? "Put on the bottom" : q.pick === "discard" ? "Discard it" : ui.picks.length === 0 ? (q.n > 1 ? "Put back on top" : "Put it back") : "Put back under it";
    return [{ label, kind: "primary", off: full, sub: full ? `${q.n} chosen` : "", fn: () => pickTap(id) }];
  }
  if (s.pending.t === "order" && s.pending.cards.includes(id)) {
    const at = ui.order.indexOf(id);
    return [at >= 0 ? { label: "Take it back", fn: () => pickTap(id) } : { label: ui.order.length ? `Put it ${["", "second", "third"][ui.order.length] || "next"}` : "Put it on top", kind: "primary", fn: () => pickTap(id) }];
  }
  return [];
}
function fillCard() {
  if (!CARD) return;
  const id = CARD.id, full = nm(id), halves = HALVES[full] || [full], p = perm(S(), id);
  $("cardHead").innerHTML = `<span>${esc(full)}</span>${halves.length === 1 ? pips(CARDS[halves[0]].cost) : ""}`;
  const faces = halves.map(h => {
    const d = CARDS[h];
    return `<div class="dd-cd">${halves.length > 1 ? `<div class="dd-dh"><b>${esc(h)}</b>${pips(d.cost)}</div>` : ""}<div class="dd-dt">${esc(typeLine(d))}</div><p>${esc(d.text)}</p></div>`;
  }).join("");
  $("cardBody").innerHTML = faces + (p ? `<p class="dd-state">${esc(stateWords(p))}</p>` : "");
  CARD_GO = cardActs(id);
  $("cardGo").innerHTML = CARD_GO.map((b, i) => `<button type="button" class="btn dd-btn${b.kind === "primary" ? " primary" : ""}" data-c="${i}" ${b.off ? "disabled" : ""}><b>${esc(b.label)}</b>${b.sub ? `<small>${esc(b.sub)}</small>` : ""}</button>`).join("");
  $("cardGo").hidden = !CARD_GO.length;
}
$("cardGo").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (b && !b.disabled) CARD_GO[Number(b.dataset.c)]?.fn(); });
$("cardClose").addEventListener("click", closeCard);
$("cardDlg").addEventListener("click", e => { if (e.target === $("cardDlg")) closeCard(); });   // a tap outside the sheet
$("cardDlg").addEventListener("close", () => { CARD = null; });

// ---------- sheets: the question's list, the graveyard, the library ----------
function syncDialogs(q) {
  const dlg = $("askDlg");
  if (q?.dlg && !ui.dlgOff) {
    $("askHead").textContent = q.dlg.title;
    const d = q.dlg, rows = d.rows || [];
    ASK = [];
    // a row that is a card has a second button beside it, to read the card first
    const opt = r => `<button type="button" class="btn dd-opt${r.on ? " primary" : ""}${r.ring && RING.has(r.ring) ? " advised" : ""}" data-d="${ASK.push(r) - 1}"><b>${esc(r.label)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</button>`;
    const btn = r => (r.card == null ? opt(r) : `<div class="dd-optrow">${opt(r)}<button type="button" class="btn dd-info" data-look="${r.card}" aria-label="Read ${esc(nm(r.card))}">?</button></div>`);
    const sections = [];                           // a heading starts a new list of options
    for (const r of rows) { if (r.head || !sections.length) sections.push({ head: r.head, rows: [] }); if (!r.head) sections[sections.length - 1].rows.push(r); }
    $("askBody").innerHTML = `${d.note ? `<p class="dd-ask-note">${esc(d.note)}</p>` : ""}${sections.map(sec => `${sec.head ? `<h4>${esc(sec.head)}</h4>` : ""}<div class="dd-opts${d.cols ? " cols" : ""}">${sec.rows.map(btn).join("")}</div>`).join("")}${d.none ? `<div class="dd-opts none">${btn(d.none)}</div>` : ""}`;
    if (!dlg.open) { dlg.showModal(); document.activeElement?.blur?.(); }   // opened by the game, not a tap: no focus ring on its first button
  } else if (dlg.open) dlg.close();
  if ($("viewDlg").open) fillView();
  if ($("cardDlg").open) fillCard();
}
let ASK = [];
$("askBody").addEventListener("click", e => {
  const r = e.target.closest("[data-look]");
  if (r) { openCard(Number(r.dataset.look)); return; }
  const b = e.target.closest("[data-d]");
  if (b) ASK[Number(b.dataset.d)]?.fn();
});
// closing the question's sheet to look at the table leaves its button in the controls
$("askLook").addEventListener("click", () => { ui.dlgOff = true; draw(); });
$("askDlg").addEventListener("cancel", e => { e.preventDefault(); ui.dlgOff = true; draw(); });

let VIEW = "";                                     // "yard" | "lib" | "log" while that sheet is open
function openYard() { VIEW = "yard"; fillView(); if (!$("viewDlg").open) $("viewDlg").showModal(); }
function openLibrary() { VIEW = "lib"; fillView(); if (!$("viewDlg").open) $("viewDlg").showModal(); }
/** The whole log (the 3D view shows its latest line), opened at its foot, the newest. */
function openLog() {
  VIEW = "log";
  fillView();
  const dlg = $("viewDlg");
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = dlg.scrollHeight;
}
function closeView() { if ($("viewDlg").open) $("viewDlg").close(); }
let VROWS = [];
function fillView() {
  const s = S(), body = $("viewBody");
  if (!s) return;
  if (VIEW === "log") {
    const dlg = $("viewDlg"), atFoot = dlg.scrollTop + dlg.clientHeight >= dlg.scrollHeight - 4;
    $("viewHead").textContent = "Log";
    body.innerHTML = `<ol class="dd-logsheet">${s.log.map(e => `<li>${esc(words(e.t))}</li>`).join("")}</ol>`;
    if (atFoot) dlg.scrollTop = dlg.scrollHeight;   // following the game, unless you've scrolled back to read
    VROWS = [];
    return;
  }
  if (VIEW === "lib") {
    $("viewHead").textContent = `Library · ${s.lib.length}`;
    const me = V.seat ?? 0, known = s.kn.filter(([id, m]) => (m & (1 << me)) && s.lib.includes(id)).map(([id]) => id).sort((a, b) => s.lib.indexOf(a) - s.lib.indexOf(b));
    const theirs = V.seat != null ? knownIn(s, 1 - me, me) : [];
    if (!sees()) {
      body.innerHTML = `<p class="dd-ask-note">One library for both players. It was shuffled at the start.</p>
        <p class="dd-sub">Revealed cards aren’t shown (Menu, Show revealed cards): remember what you have seen go there, or looked at. ${esc(nameOf(1 - me))} holds ${s.hand[1 - me].length}.</p>`;
      VROWS = [];
      return;
    }
    body.innerHTML = `<p class="dd-ask-note">One library for both players. It was shuffled at the start; you know a card only if you have seen it go there or looked at it.</p>
      ${known.length ? `<ol class="dd-known">${known.map(id => `<li><span>${s.lib.indexOf(id) + 1}</span><button type="button" class="dd-chip dd-name" data-look="${id}">${esc(nm(id))}</button></li>`).join("")}</ol>` : `<p class="dd-sub">You know no card in it.</p>`}
      <h4>${esc(nameOf(1 - me))}’s hand · ${s.hand[1 - me].length}</h4>
      ${theirs.length ? `<p class="dd-sub">You saw these go there: ${theirs.map(chip).join(" ")}</p>` : `<p class="dd-sub">You know none of its cards.</p>`}`;
    VROWS = [];
    return;
  }
  const armG = ui.arm && ui.arm.moves[0].targets[0].k === "g";
  $("viewHead").textContent = armG ? "Choose a card" : `Graveyard · ${s.yard.length}`;
  const by = new Map();
  for (let i = s.yard.length - 1; i >= 0; i--) { const id = s.yard[i], k = DECK[id]; if (!by.has(k)) by.set(k, []); by.get(k).push(id); }
  VROWS = [];
  const rows = [];
  for (const [name, ids] of by) {
    const half = HALVES[name] ? HALVES[name][1] : name;
    const casts = MV.filter(m => m.t === "cast" && m.from === "yard" && DECK[m.card] === name);
    let btn = "";
    if (armG) {
      const hit = ui.arm.moves.find(m => m.targets[0].id === ids[0]);
      if (!hit) continue;
      VROWS.push(() => act2(hit));
      btn = `<button type="button" class="btn dd-sm primary" data-v="${VROWS.length - 1}">Choose</button>`;
    } else if (casts.length) {
      const label = CARDS[half].flashback ? `Flashback ${costWords(CARDS[half].flashback)}` : `Cast ${half}`;
      VROWS.push(() => { closeView(); cast(casts.map(m => ({ ...m, card: ids[0] })), half); });
      btn = `<button type="button" class="btn dd-sm primary" data-v="${VROWS.length - 1}">${esc(label)}</button>`;
    }
    rows.push(`<li><button type="button" class="dd-chip dd-name" data-look="${ids[0]}">${esc(name)}</button>${ids.length > 1 ? `<span class="n">× ${ids.length}</span>` : ""}${btn}</li>`);
  }
  body.innerHTML = `${rows.length ? `<ol class="dd-yard">${rows.join("")}</ol>` : `<p class="dd-sub">${armG ? "No card here is a legal target." : "Empty."}</p>`}
    ${s.exile.length && !armG ? `<h4>Exiled</h4><p class="dd-sub">${s.exile.map(id => esc(nm(id))).join(", ")}</p>` : ""}`;
}
const act2 = m => { closeView(); return act(m); };
$("viewBody").addEventListener("click", e => {
  const r = e.target.closest("[data-look]");
  if (r) { openCard(Number(r.dataset.look)); return; }
  const b = e.target.closest("[data-v]");
  if (b) VROWS[Number(b.dataset.v)]?.();
});
$("viewClose").addEventListener("click", () => { closeView(); if (ui.arm) { ui.arm = null; draw(); } });
$("viewDlg").addEventListener("close", () => { VIEW = ""; });

/** A finished game's result goes to the database, once (a finished game opened again, a reload, is over again). */
function onOver(v) {
  if (v.seat == null) return;
  recordResult(v, { level: opts.level, think: opts.think, pace: opts.pace, view: opts.view });
  setTimeout(() => { if (V?.over) showEnd(V); }, 1100);
}
// the end of a game: who won and why, how the game went (the judge's chance of winning after each action that settled and
// at the start of each turn, which the engine and the rules note as it's played: tap or drag along it for the chances and
// the words of the log), the moves that cost the most
let endCurve = null, endNames = [], endSel = -1, endMode = "acts", endFlags = [], endDrag = false;
/** The curve as it's drawn: every action, or only each turn's start. */
const endShown = () => (endMode === "turns" ? byTurn(endCurve) : endCurve);
/** What the log said as a point was noted (an action's), in words, the first few lines (the cast comes first). */
const saidOf = p => {
  const lines = p?.kind ? linesBetween(S().log, p.from, p.ln).map(words) : [];
  return lines.length > 4 ? [...lines.slice(0, 3), `${lines[3]} …`] : lines;
};
function paintChart() {
  const c = endShown();
  $("endChart").innerHTML = chartSvg(c, endSel, endMode === "acts" ? endFlags : []);
  $("endRead").textContent = endSel >= 0 ? readoutOf(c, endSel, endNames, saidOf(c.points[endSel]))
    : hasActions(endCurve) ? "Tap or drag along the chart for the chances after each move." : "Tap a turn on the chart for its chances.";
  for (const b of document.querySelectorAll("#endMode [data-detail]")) b.setAttribute("aria-pressed", String(b.dataset.detail === endMode));
  for (const b of document.querySelectorAll(".dd-mv-row")) b.setAttribute("aria-pressed", String(endMode === "acts" && Number(b.dataset.i) === endSel));
}
function pickPoint(e) {
  const r = $("endChart").querySelector("svg")?.getBoundingClientRect();
  if (!r?.width) return;
  endSel = pointAt(endShown(), ((e.clientX - r.left) / r.width) * BOX.w);
  paintChart();
}
function stepPoint(e) {
  const k = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (!k || !$("endChart")) return; // no chart on this game's sheet (the one before's curve is still in endCurve)
  e.preventDefault();
  const c = endShown(), n = c.points.length + (c.end == null ? 0 : 1);
  endSel = Math.max(0, Math.min(n - 1, (endSel < 0 ? (k > 0 ? -1 : n) : endSel) + k));
  paintChart();
}
/** The moves that cost the most, in two short lists: yours (numbered as they're ringed on the chart) and the other's. */
function movesHtml(m) {
  const row = (p, n) => `<li><button type="button" class="dd-mv-row" data-i="${p.i}" aria-pressed="false">${n ? `<b class="dd-mv-n">${n}</b>` : ""}<span class="dd-mv-d">${String(p.d).replace("-", "−")}</span><span class="dd-mv-w"><i>Turn ${p.turn}</i> ${esc(saidOf(p).join("; "))}</span></button></li>`;
  const list = (head, ps, none, numbered) => `<h4 class="dd-mv-h">${esc(head)}</h4>${ps.length ? `<ol class="dd-mv">${ps.map((p, k) => row(p, numbered ? k + 1 : 0)).join("")}</ol>` : `<p class="dd-sub">${esc(none)}</p>`}`;
  return list("Your moves that cost the most", m.mine, `No move of yours cost you more than ${MIN_FALL - 1} points.`, true)
    + list(`${nameOf(1 - (V.seat ?? 0))}’s moves that hurt you`, m.theirs, `None of ${nameOf(1 - (V.seat ?? 0))}’s moves cost you more than ${MIN_FALL - 1} points.`, false)
    + `<p class="dd-sub">A fall is the judge’s, who sees both hands: a play into a card you couldn’t know of can fall too. A pass isn’t a move here; what it let through is the other’s.</p>`;
}
function showEnd(v) {
  const s = v.state, mine = s.winner === v.seat;
  $("endHead").textContent = s.winner < 0 ? "A drawn game" : mine ? "You win" : `${nameOf(s.winner)} wins`;
  const loser = nameOf(1 - s.winner), you = isMe(1 - s.winner);
  const why = s.winner < 0 ? "Both players lost on the same check."
    : s.why === "library" ? `${you ? "You" : loser} drew from an empty library.`
    : s.why === "conceded" ? `${you ? "You" : loser} conceded.`
    : `${you ? "You are" : `${loser} is`} out of life.`;
  endCurve = curveOf(s, v.seat);
  endNames = [nameOf(0), nameOf(1)];
  endSel = -1;
  endMode = "acts";
  const moves = hasActions(endCurve) ? momentsOf(endCurve) : null;
  endFlags = moves ? moves.mine.map((p, k) => [p.i, k + 1]) : [];
  const drawn = worthDrawing(endCurve);
  $("endBody").innerHTML = `<p>${esc(why)}</p>
    <ul class="dd-standings"><li class="${isMe(0) ? "me" : ""}"><span>${esc(nameOf(0))}</span><b>${s.life[0]}</b></li><li class="${isMe(1) ? "me" : ""}"><span>${esc(nameOf(1))}</span><b>${s.life[1]}</b></li></ul>
    ${drawn ? `<h3 class="dd-end-h">How the game went</h3>
    ${moves ? `<div id="endMode" class="dd-rv-seg" role="group" aria-label="Chart detail"><button type="button" data-detail="acts" aria-pressed="true">Every action</button><button type="button" data-detail="turns" aria-pressed="false">By turn</button></div>` : ""}
    <div id="endChart" class="dd-adv-wrap"></div>
    <p id="endRead" class="dd-adv-read" aria-live="polite"></p>
    <p class="dd-adv-cap">${esc(captionOf(endCurve, endNames))} <span class="dd-adv-src">Rated by the computer's judge, which sees both hands.</span></p>
    ${moves ? `<h3 class="dd-end-h">Where it turned</h3>${movesHtml(moves)}` : ""}` : `<p class="dd-end-note">Over too soon for a chart.</p>`}
    <p class="dd-end-note">${s.turn ? `${s.turn} turn${s.turn === 1 ? "" : "s"}` : "Over before the first turn"}. ${s.lib.length} cards were left in the library. The loser goes first next game.</p>`;
  if (drawn) paintChart();
  $("endAgain").hidden = !page.host;
  if (!$("endDlg").open) $("endDlg").showModal();
}
function newGame() {
  $("endDlg").open && $("endDlg").close();
  page.deal({}, 2);
}
/** Whether you may concede: a game of yours still on. */
const mayConcede = () => !!V?.G && !V.over && V.seat != null;
/** Menu, Concede: the game lost there and then, whoever's decision it is, once you've said so (it counts as a loss). */
async function concede() {
  if (!mayConcede() || !confirm(`Concede this game to ${nameOf(1 - V.seat)}? It counts as a loss.`)) return;
  const why = await page.move({ t: "concede" });
  if (why) toast(why);
}
$("endAgain").addEventListener("click", newGame);
$("endDlg").addEventListener("keydown", stepPoint); // the arrows step along the chart from wherever focus is in the sheet
// the chart is read by touching it or dragging along it (a tap or a press moves the mark to the nearest point; the page
// still scrolls up and down from it), the buttons under it by tapping: a move listed is shown on the chart
$("endBody").addEventListener("pointerdown", e => {
  const wrap = e.target.closest("#endChart");
  if (!wrap) return;
  endDrag = true;
  wrap.setPointerCapture?.(e.pointerId);
  pickPoint(e);
});
$("endBody").addEventListener("pointermove", e => { if (endDrag) pickPoint(e); });
for (const type of ["pointerup", "pointercancel"]) $("endBody").addEventListener(type, () => {
  if (endDrag) $("endDlg").focus({ preventScroll: true });   // a touch on the picture leaves focus on the page, where the arrow keys would be lost
  endDrag = false;
});
$("endBody").addEventListener("click", e => {
  const mode = e.target.closest("#endMode [data-detail]"), row = e.target.closest(".dd-mv-row");
  if (mode) { endMode = mode.dataset.detail; endSel = -1; paintChart(); }
  else if (row) {
    endMode = "acts"; endSel = Number(row.dataset.i);
    paintChart();
    $("endChart").scrollIntoView({ block: "start", behavior: "smooth" });
  }
});
$("endTable").addEventListener("click", () => $("endDlg").close());
function openMenu() {
  const body = $("menuBody");
  body.replaceChildren();
  const play = part(body, "play");
  // No new game from here (31 October 2026, Korbi): a game is played out or conceded; the next is dealt from the sheet that
  // ends it (or from the buttons under a finished table)
  if (mayConcede()) play.append(action("Concede", concede, ""));
  play.append(action(`Name: ${page.name}`, changeName, "link"));
  const set = part(body, "settings");
  set.append(choice("Computer's pace", PACES, opts.pace, v => { opts.pace = v; saveOpts(); draw(); page.runner.kick(); }));
  if (!$("menuDlg").open) $("menuDlg").showModal();
}

// ---------- the buttons at the top: hold priority, tap my own lands ----------
// The two switches always to hand (29 October 2026, Korbi): lit while on, in the header and in full screen too
const TOGGLES = [["holdBtn", "hold", "Hold priority when I cast"], ["tapBtn", "manual", "Choose which lands to tap"]];
function paintToggles() {
  for (const [id, key] of TOGGLES) $(id).setAttribute("aria-pressed", String(!!opts[key]));
}
for (const [id, key, label] of TOGGLES) {
  $(id).addEventListener("click", () => {
    opts[key] = !opts[key];
    saveOpts();
    paintToggles();
    toast(`${label}: ${opts[key] ? "on" : "off"}`);
  });
}
paintToggles();

// ---------- full screen ----------
// The header gives way to the menu's button, faded at the top right (the title goes), with the two switches beside it.
// It is the only layout: the page is the table, and the table has all the room there is.
function fitCorner() {
  const r = document.querySelector("#app > .top").getBoundingClientRect();
  $("app").style.setProperty("--dd-corner", `${Math.ceil(innerWidth - r.left + 6)}px`);
}
$("app").classList.add("dd-full");
new ResizeObserver(fitCorner).observe(document.querySelector("#app > .top"));
addEventListener("resize", fitCorner);
fitCorner();

/** The table is always the battlefield in 3D (#board3d, dandan-3d.js); the tiled table (#board) is not shown. The hand and
 *  the buttons are the same elements in both, drawn by whichever view is showing. */
function showView() {
  $("app").classList.add("dd3");
  $("board").hidden = true;
  $("board3d").hidden = false;
  table3d?.reset();
}

// ---------- wiring ----------
document.querySelector(".dd-mark").innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="50" cy="93" rx="32" ry="3" fill="#1C2A34" opacity=".22"/><g transform="rotate(-8 50 50)"><rect x="19" y="8" width="62" height="82" rx="6" fill="#FBF4E4" stroke="#1C2A34" style="stroke-width: calc(3 * var(--wire, 1))"/><rect x="25" y="14" width="50" height="52" rx="3" fill="#CFE3EA" stroke="#C8923A" stroke-width="1.4"/><path d="M29 40Q44 22 62 34L73 26V54L62 46Q44 58 29 40Z" fill="#1F6E8C" stroke="#1C2A34" style="stroke-width: calc(2.4 * var(--wire, 1))" stroke-linejoin="round"/><path d="M50 30Q56 40 50 50" fill="none" stroke="#E2B865" stroke-width="2" stroke-linecap="round"/><circle cx="37" cy="38" r="3" fill="#FBF4E4" stroke="#1C2A34" stroke-width="1.2"/><circle cx="36.4" cy="38" r="1.2" fill="#1C2A34"/><path d="M27 60q4-3 8 0t8 0 8 0 8 0 8 0" fill="none" stroke="#1F6E8C" stroke-width="1.8" stroke-linecap="round"/><path d="M28 76H46M28 82H40" stroke="#C8923A" stroke-width="2.2" stroke-linecap="round"/></g><path d="M80 52C80 52 68 66 68 75C68 82 73.4 87 80 87C86.6 87 92 82 92 75C92 66 80 52 80 52Z" fill="#3F7FB5" stroke="#1C2A34" style="stroke-width: calc(2.8 * var(--wire, 1))" stroke-linejoin="round"/><path d="M75 74Q75 80 80 82" fill="none" stroke="#FBF4E4" stroke-width="2" stroke-linecap="round" opacity=".7"/></svg>`;
$("menuBtn").addEventListener("click", openMenu);
$("menuClose").addEventListener("click", () => $("menuDlg").close());
table3d = createTable3d({
  view: () => V, ui: () => ui, moves: () => MV, rings: () => RING, hover: () => hover, POINTER, LAND_CODE, quiet: false,
  esc, pips, nameOf, isMe, short, soft: n => SOFT[n] || n, words, typeLine, stateWords, itemWords, armedKeys, targetKey, payable,
  headline, waitLine, readHead, canAct, handOrder, fetchable: () => FETCH, sees,
});
showView();
window.__dandan = { page, get view() { return V; }, get ui() { return ui; }, opts };

// ---------- joining the table ----------
// Whoever opens the page is asked their name once (kept on this device, and changed from the menu), and then sits down at
// a table of their own with the computer: the first game is dealt at once. The name goes with every result to the database.
async function changeName() {
  const name = await askName({ title: "Your name", note: "Shown at the table, and kept with your results.", button: "Save", closable: true });
  if (name) { page.rename(name); draw(); }
}
draw();
// the page is drawn: the rete that shows while a page loads (style.css) goes
requestAnimationFrame(() => document.documentElement.classList.add("ready"));
(async () => {
  let name = savedName();
  if (!name) name = await askName({ title: "Join the table", note: "Your name, as it will be kept with your results.", button: "Sit down" });
  page.rename(name);
  if (!page.view.G) newGame();
  draw();
})();
