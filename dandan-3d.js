// Dandan's second view (Menu, View: Table or 3D; 22 October 2026, Korbi asking for "a heavily visual mode … inspired by
// MTG Arena like layout"): the same game drawn as a battlefield seen at an angle. Each player's lands lie in the row
// nearest them and their Dandâns in front of those, both halves on one plane tipped away from you (CSS perspective: the
// other player's half is further off and smaller); the one library and the one graveyard sit on the line between the
// halves, where both players reach them, and the stack floats over that line, each spell's picture with an arrow to
// what it's aimed at; the avatars and their life are at either end, your hand fanned below. Cards carry pictures
// (dandan-art.js) and move as the game does: drawn from the library, played from a hand, sent to the graveyard or back
// to the library, flown from where they were; a land tapped turns on its side, an attacker steps forward, a row that
// grows or shrinks slides to make room. It draws into its own section (#board3d) and the page's hand, with the same
// marks on every card (data-card, data-perm, data-tk, data-sid, data-act) as the table view, so a tap means what it
// does there and dandan.js's handlers serve both.
import { CARDS, DECK, HALVES } from "./dandan-cards.js";
import { nm, defOf, perm, pt, isLand, isCreature, manaAlts, needType, poolOf, knownIn, topKnown, knOf } from "./dandan-core.js";
import { SPRITE, art, back } from "./dandan-art.js";

/** The steps of a turn, as the track in your bar marks them. */
export const STEPS = ["upkeep", "draw", "main1", "attackers", "blockers", "damage", "main2", "end"];
const STEP_SHORT = { mull: "Opening hands", upkeep: "Upkeep", draw: "Draw", main1: "Main phase", attackers: "Attack", blockers: "Blocks", damage: "Damage", main2: "Second main", end: "End step" };
const TYPE_WORDS = { land: "Land", creature: "Creature", instant: "Instant", sorcery: "Sorcery", token: "Token" };
const LAND_FIRST = { Island: 0, Clue: 9 };
const FLY_MS = 460, SLIDE_MS = 320, MOST_FLIGHTS = 24;
const EASE = "cubic-bezier(.3, .7, .2, 1)";

// ---------- what can be worked out without a page (tests/dandan.mjs) ----------
/** Where every card is, by id: "h0" or "h1" a hand, "bf" the battlefield, "st" the stack, "y" the graveyard, "l" the library, "x" exile. */
export function zonesOf(s) {
  const z = new Map();
  s.hand.forEach((h, seat) => { for (const id of h) z.set(id, `h${seat}`); });
  for (const p of s.bf) z.set(p.id, "bf");
  for (const it of s.stack) if (it.card != null && !it.copy) z.set(it.card, "st");
  for (const id of s.yard) z.set(id, "y");
  for (const id of s.lib) z.set(id, "l");
  for (const id of s.exile) z.set(id, "x");
  return z;
}
/** The cards that changed place from one state's zones to the next: [{ id, from, to }], to null for a token that's gone. */
export function moved(was, now) {
  const out = [];
  for (const [id, to] of now) { const from = was.get(id); if (from !== to) out.push({ id, from: from ?? null, to }); }
  for (const [id, from] of was) if (!now.has(id)) out.push({ id, from, to: null });
  return out;
}
/**
 * A side's lands and Clues in the order they lie: Islands first, alike ones together as a pile (the same card, tapped
 * or not alike, its text unchanged or changed alike), each with its place in its pile: [{ p, first, last, n }].
 */
export function piles(list) {
  const key = p => `${nm(p.id)}|${p.tapped ? 1 : 0}|${JSON.stringify(p.tc || [])}`;
  const rank = p => LAND_FIRST[nm(p.id)] ?? 1;
  // a land Mind Bent into another type lies after its untouched fellows, tapped or not
  const sorted = [...list].sort((a, b) => rank(a) - rank(b) || nm(a.id).localeCompare(nm(b.id)) || (a.tc ? 1 : 0) - (b.tc ? 1 : 0)
    || (a.tapped ? 1 : 0) - (b.tapped ? 1 : 0) || key(a).localeCompare(key(b)) || a.id - b.id);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const k = key(sorted[i]);
    let j = i;
    while (j + 1 < sorted.length && key(sorted[j + 1]) === k) j++;
    for (let m = i; m <= j; m++) out.push({ p: sorted[m], first: m === i, last: m === j, n: j - i + 1 });
    i = j;
  }
  return out;
}

const still = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/**
 * The view, given what it reads of dandan.js: the view and state on screen (view(), S()), the picks being made (ui()),
 * the moves you could make now (moves()), the coach's rings (rings()), the card a pointer is on (hover()), and its
 * words and helpers (esc, pips, nameOf, isMe, short, soft, words, typeLine, stateWords, itemWords, armedKeys, targetKey, payable,
 * headline, waitLine, readHead, canAct, handOrder, POINTER, LAND_CODE, quiet: a watching frame, which shows no motion),
 * and fetchable(): the cards in your hand a Flood Plain's Island would pay for.
 */
export function createTable3d(c) {
  const $ = id => document.getElementById(id);
  const box = $("board3d"), handBox = $("hand");
  box.innerHTML = `
    <div class="d3-bar foe" id="d3foe"></div>
    <div class="d3-field" id="d3field">
      <div class="d3-stage"><div class="d3-mat" id="d3mat">
        <div class="d3-row lands far" id="d3fl"></div>
        <div class="d3-row cres far" id="d3fc"></div>
        <div class="d3-mid" id="d3mid">
          <button type="button" class="d3-pile lib" id="d3lib" data-act="lib"></button>
          <button type="button" class="d3-pile yard" id="d3yard" data-act="yard"></button>
        </div>
        <div class="d3-row cres near" id="d3mc"></div>
        <div class="d3-row lands near" id="d3ml"></div>
      </div></div>
      <svg class="d3-arrows" id="d3arrows" aria-hidden="true"><defs>${["mine", "theirs", "block"].map(k => `<marker id="d3-head-${k}" class="${k}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z"/></marker>`).join("")}</defs><g></g></svg>
      <div class="d3-centre" id="d3centre" aria-live="polite">
        <div class="d3-prompt" id="d3prompt" hidden></div>
        <div class="d3-stack" id="d3stack" aria-label="The stack, the last cast on the right" hidden></div>
        <div class="d3-phase" id="d3phase"></div>
      </div>
      <div class="d3-banner" id="d3banner" aria-hidden="true"></div>
      <button type="button" class="d3-look" id="d3look" data-act="unlook" aria-label="Put the card down" hidden></button>
    </div>
    <div class="d3-bar me" id="d3me"></div>`;
  document.body.insertAdjacentHTML("beforeend", `${SPRITE}<div class="d3-fx" id="d3fx" aria-hidden="true"></div>`);
  const fx = $("d3fx"), field = $("d3field"), mat = $("d3mat"), lookEl = $("d3look");
  const rows = { fl: $("d3fl"), fc: $("d3fc"), mc: $("d3mc"), ml: $("d3ml") };
  const S = () => c.view()?.state;
  const esc = c.esc;
  let last = null, lastKey = "", pointerX = 0, overCard = false, asked = false;
  let fresh = [];                                  // the stack's items new in this draw (a trigger rises; a spell is flown in)

  /** An element's contents, set only when they change (the pulse round the avatar to move runs on rather than restarts). */
  const fill = (el, html) => { if (el._h !== html) { el.innerHTML = html; el._h = html; } };

  // ---------- keyed drawing: an element stays from one draw to the next while its card does ----------
  /** The parent's children as these items, in order: each kept from the last draw where it was (so it can slide or turn
   *  rather than be drawn afresh), made where it's new, with its class, marks and contents; the rest taken out. */
  function sync(parent, items) {
    const have = new Map(), made = [];
    for (const el of [...parent.children]) { if (el.dataset.k) have.set(el.dataset.k, el); else el.remove(); }
    items.forEach((it, i) => {
      let el = have.get(it.key);
      if (el) have.delete(it.key);
      else { el = document.createElement("button"); el.type = "button"; el.dataset.k = it.key; made.push(el); }
      if (el.className !== it.cls) el.className = it.cls;
      for (const [k, v] of Object.entries(it.attrs || {})) { const s = v == null ? null : String(v); if (el.getAttribute(k) !== s) { if (s == null) el.removeAttribute(k); else el.setAttribute(k, s); } }
      for (const [k, v] of Object.entries(it.vars || {})) if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v);
      if (el._html !== it.html) { el.innerHTML = it.html; el._html = it.html; }
      if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null);
    });
    for (const el of have.values()) el.remove();
    return made;
  }

  // ---------- the cards' faces ----------
  const pipsOf = alts => alts.map(a => a.map(x => `<i class="dd-pip ${x === "U" || x === "R" ? x : "g"}">${x}</i>`).join("")).join('<i class="d3-or">/</i>');
  /** A Dandân on the table: its picture, what's been done to it, its power and toughness as they stand. */
  function creFace(p, num) {
    const s = S(), [a, b] = pt(p), base = defOf(p.id).pt;
    const icons = [p.walk ? '<i class="d3-ic walk" title="Islandwalk"></i>' : "", needType(p) !== "Island" ? `<i class="d3-ic want" title="Wants a ${esc(needType(p))}">${esc(needType(p)[0])}</i>` : "",
      p.ent >= s.turn && p.ctl === s.active ? '<i class="d3-ic new" title="Came this turn"></i>' : ""].join("");
    return `<span class="d3-face cre">${art("Dandân")}${icons ? `<span class="d3-ics">${icons}</span>` : ""}<span class="d3-pt"><b${a !== base[0] ? ' class="chg"' : ""}>${a}</b>/<b${b !== base[1] ? ' class="chg"' : ""}>${b}</b></span>${num ? `<i class="d3-num">${num}</i>` : ""}</span>`;
  }
  /** A land (or a Clue) on the table: its picture, the mana it makes, a short name for any but the plain Island, a pile's count. */
  function landFace(p, n) {
    const name = nm(p.id), clue = name === "Clue", alts = clue ? [] : manaAlts(p);
    const code = clue ? "Clue" : name === "Island" && !p.tc ? "" : c.LAND_CODE[name] || "";
    return `<span class="d3-face land">${art(name)}${alts.length ? `<span class="d3-mana">${pipsOf(alts)}</span>` : ""}${code ? `<span class="d3-code">${esc(code)}</span>` : ""}${n > 1 ? `<i class="d3-count">×${n}</i>` : ""}</span>`;
  }
  /** A card in your hand: its name and cost across the top, its picture, its type. */
  function heldFace(id, mark) {
    const d = defOf(id), name = DECK[id];
    return `<span class="d3-face held ${d.type}"><span class="d3-hh"><span class="d3-hn">${esc(c.soft(c.short(name)))}</span>${c.pips(d.cost)}</span><span class="d3-ha">${art(name)}</span><span class="d3-ht">${TYPE_WORDS[d.type]}</span>${mark ? `<i class="d3-num">${mark}</i>` : ""}</span>`;
  }
  /** A card in flight: its picture and its name. */
  function flyingFace(id) {
    const d = defOf(id), name = nm(id);
    return `<span class="d3-face fly ${d.type}">${art(name)}<span class="d3-fn">${esc(c.short(name))}</span></span>`;
  }
  /** A card read in full: its name and cost, its picture, each half's type and text, what's been done to it. */
  function bigCard(id) {
    const s = S(), full = nm(id), halves = HALVES[full] || [full], p = perm(s, id), d0 = CARDS[halves[0]];
    const ptNow = d0.pt ? (p ? pt(p) : d0.pt) : null;
    return `<span class="d3-big ${d0.type}"><span class="d3-bh"><b>${esc(full)}</b>${halves.length === 1 ? c.pips(d0.cost) : ""}</span><span class="d3-ba">${art(full)}</span>
      ${halves.map(h => { const d = CARDS[h]; return `<span class="d3-bt">${halves.length > 1 ? `<span class="d3-bhh"><b>${esc(h)}</b>${c.pips(d.cost)}</span>` : ""}<span class="d3-tl">${esc(c.typeLine(d))}</span><span class="d3-tx">${esc(d.text)}</span></span>`; }).join("")}
      ${p ? `<span class="d3-bs">${esc(c.stateWords(p))}</span>` : ""}${ptNow ? `<span class="d3-pt big">${ptNow[0]}/${ptNow[1]}</span>` : ""}</span>`;
  }

  // ---------- the bars at either end: the avatar and life, the hand they hold, the turn's step ----------
  const initial = name => [...String(name || "?").trim()][0]?.toUpperCase() || "?";
  function avatar(seat) {
    const s = S(), v = c.view(), them = seat !== (v.seat ?? 0), armed = c.armedKeys(), ring = c.rings();
    const turn = s.active === seat && !s.over && s.step !== "mull";
    return `<button type="button" class="d3-av ${them ? "foe" : "me"}${turn ? " turn" : ""}${v.toMove === seat && !s.over ? " move" : ""}${armed.has(`p:${seat}`) ? " tgt" : ""}${ring.has(`t:p:${seat}`) ? " advised" : ""}" data-tk="p:${seat}"${them ? ' data-act="known"' : ""} aria-label="${esc(c.nameOf(seat))}, ${s.life[seat]} life">
      <span class="d3-init">${esc(initial(c.nameOf(seat)))}</span><b class="d3-life">${s.life[seat]}</b></button>`;
  }
  function landsWords(seat) {
    const lnd = S().bf.filter(p => p.ctl === seat && isLand(p));
    return lnd.length ? `${lnd.filter(p => !p.tapped).length}/${lnd.length} lands` : "no lands";
  }
  const floating = seat => { const pool = poolOf(S(), seat); return pool ? ` · <span class="d3-float">${pipsOf(pool.split("").map(x => [x]))} floating</span>` : ""; };
  function bars() {
    const s = S(), v = c.view(), me = v.seat ?? 0, foe = 1 - me;
    // their hand: the backs of its cards, those you know face up (seen going there), tapped to see what you know
    const known = v.seat != null && c.sees() ? knownIn(s, foe, me) : [], n = s.hand[foe].length;
    const shown = [...known.slice(0, n), ...Array(Math.max(0, n - known.length)).fill(null)].slice(0, 12);
    const fan = `<button type="button" class="d3-fan" data-act="known" aria-label="${esc(c.nameOf(foe))}’s hand: ${n} card${n === 1 ? "" : "s"}${known.length ? `, ${known.length} known` : ""}" style="--n:${Math.max(1, shown.length)}">
      ${shown.map((id, j) => `<span class="d3-fc${id != null ? " known" : ""}" style="--j:${j - (shown.length - 1) / 2}"${id != null ? ` data-id="${id}"` : ""}>${id != null ? art(nm(id)) : back()}</span>`).join("")}<b class="d3-fn2">${n}</b></button>`;
    fill($("d3foe"), `${avatar(foe)}<span class="d3-who"><span class="d3-l1"><b class="d3-name">${esc(c.nameOf(foe))}</b></span><span class="d3-meta">${landsWords(foe)}${known.length ? ` · ${known.length} known` : ""}${floating(foe)}</span></span>${fan}`);
    // yours: the avatar, the latest line of the log (tapped for all of it), the track of the turn's steps
    const at = STEPS.indexOf(s.step), line = s.log[s.log.length - 1];
    const track = `<span class="d3-track ${c.isMe(s.active) ? "mine" : "theirs"}" aria-label="Turn ${s.turn}, ${STEP_SHORT[s.step] || s.step}">
      <span class="d3-ticks">${STEPS.map((st, i) => `<i class="${i === at ? "on" : i < at ? "past" : ""}"></i>`).join("")}</span><b>${s.step === "mull" ? STEP_SHORT.mull : `${s.turn} · ${STEP_SHORT[s.step] || s.step}`}</b></span>`;
    // while a target is chosen, the line says so (the lit ones are on the table: the middle stays clear of them)
    const arm = c.ui().arm, k = arm?.moves[0].targets[0].k;
    const said = arm ? `<b>${esc(arm.label)}</b>: choose ${k === "p" ? "a player" : k === "g" ? "a card in the graveyard" : "a target"}` : line ? esc(c.words(line.t)) : "";
    fill($("d3me"), `${avatar(me)}<span class="d3-who"><span class="d3-l1"><b class="d3-name">${esc(c.nameOf(me))}</b><span class="d3-meta">${landsWords(me)}${floating(me)}</span></span>
      <button type="button" class="d3-tick${arm ? " arm" : ""}" data-act="log" aria-label="The log">${said}</button></span>${track}`);
  }

  // ---------- the battlefield: each side's lands and Dandâns ----------
  function creItems(seat, q) {
    const s = S(), u = c.ui(), armed = c.armedKeys(), ring = c.rings(), pend = s.pending, pairs = s.combat?.blk || [];
    return s.bf.filter(p => p.ctl === seat && isCreature(p)).map(p => {
      const att = !!s.combat?.att.includes(p.id), charging = att || u.atk.includes(p.id);
      const blocking = pairs.some(([x]) => x === p.id) || u.blk.some(([x]) => x === p.id);
      const can = (q?.pick === "attack" && pend.ids.includes(p.id)) || (q?.pick === "block" && (pend.blockers.includes(p.id) || pend.attackers.includes(p.id)));
      const link = pairs.findIndex(([x, y]) => x === p.id || y === p.id), mine = u.blk.findIndex(([x, y]) => x === p.id || y === p.id);
      const [a, b] = pt(p), tags = [att ? "attacking" : "", p.tapped && !att ? "tapped" : "", p.walk ? "islandwalk" : "", needType(p) !== "Island" ? `wants ${needType(p)}` : ""].filter(Boolean);
      return {
        key: `c${p.id}`,
        cls: `d3-slot cre${p.tapped ? " tapped" : ""}${charging ? " att" : ""}${blocking ? " blk" : ""}${can ? " can" : ""}${u.atk.includes(p.id) || u.blkSel === p.id ? " sel" : ""}${armed.has(`c:${p.id}`) ? " tgt" : ""}${u.look?.id === p.id ? " look" : ""}${ring.has(`t:c:${p.id}`) ? " advised" : ""}`,
        attrs: { "data-perm": p.id, "data-tk": `c:${p.id}`, "aria-label": `Dandân ${a}/${b}${tags.length ? `, ${tags.join(", ")}` : ""}` },
        html: creFace(p, link >= 0 ? link + 1 : mine >= 0 ? mine + 1 : 0),
      };
    });
  }
  function landItems(seat) {
    const s = S(), u = c.ui(), armed = c.armedKeys(), ring = c.rings();
    return piles(s.bf.filter(p => p.ctl === seat && !isCreature(p))).map(({ p, first, last: top, n }) => ({
      key: `c${p.id}`,
      cls: `d3-slot land${p.tapped ? " tapped" : ""}${p.tc ? " bent" : ""}${first ? " first" : ""}${top ? "" : " under"}${armed.has(`c:${p.id}`) ? " tgt" : ""}${u.tap ? (u.tap.ids.includes(p.id) ? " pay" : c.payable(p) ? " can" : "") : ""}${u.look?.id === p.id ? " look" : ""}${ring.has(`t:c:${p.id}`) ? " advised" : ""}`,
      attrs: { "data-perm": p.id, "data-tk": `c:${p.id}`, "aria-label": `${nm(p.id)}${p.tapped ? ", tapped" : ""}${u.tap?.ids.includes(p.id) ? ", chosen to tap" : ""}${top && n > 1 ? `, ${n} alike` : ""}` },
      html: landFace(p, top ? n : 0),
    }));
  }
  /** The library and the graveyard on the line between the halves. */
  function drawPiles() {
    const s = S(), v = c.view(), lib = s.lib.length, known = c.sees() ? topKnown(s, v.seat ?? 0) : null, top = s.yard[s.yard.length - 1];
    const deep = n => Math.min(5, Math.ceil(n / 14));
    const libEl = $("d3lib"), yardEl = $("d3yard");
    libEl.className = `d3-pile lib deep${deep(lib)}`;
    libEl.setAttribute("aria-label", `Library, ${lib} cards${known != null ? `; the top is ${nm(known)}` : ""}`);
    fill(libEl, `<span class="d3-pc">${lib ? (known != null ? `<span class="d3-face land known">${art(nm(known))}<span class="d3-code">▲ ${esc(c.short(nm(known)))}</span></span>` : back()) : ""}</span><b class="d3-n">${lib}</b><small>Library</small>`);
    const casts = c.moves().some(m => m.from === "yard");
    yardEl.className = `d3-pile yard deep${deep(s.yard.length)}${casts ? " can" : ""}${c.rings().has("pile:yard") ? " advised" : ""}`;
    yardEl.setAttribute("aria-label", `Graveyard, ${s.yard.length} cards`);
    fill(yardEl, `<span class="d3-pc">${top != null ? `<span class="d3-face ${defOf(top).type}">${art(nm(top))}<span class="d3-code">${esc(c.short(nm(top)))}</span></span>` : ""}</span><b class="d3-n">${s.yard.length}</b><small>Graveyard</small>`);
  }

  // ---------- over the line between the halves: the question, the stack, the turn ----------
  function stackItems() {
    const s = S(), armed = c.armedKeys(), ring = c.rings(), n = s.stack.length;
    return s.stack.map((it, i) => {
      const top = i === n - 1, w = c.itemWords(it), id = it.card ?? it.src, d = it.card != null ? CARDS[it.name] : null;
      const text = top ? d?.text || (id != null ? defOf(id).text : "") : "";
      const name = `${w.name}${it.copy ? " (copy)" : ""}`;
      return {
        key: `s${it.sid}`,
        cls: `d3-st ${c.isMe(it.ctl) ? "mine" : "theirs"}${top ? " top" : ""}${armed.has(`s:${it.sid}`) ? " tgt" : ""}${ring.has(`t:s:${it.sid}`) ? " advised" : ""}`,
        attrs: { "data-sid": it.sid, "data-tk": `s:${it.sid}`, "aria-label": `${name}, ${c.nameOf(it.ctl)}’s${w.to ? `, at ${w.to}` : ""}` },
        html: `<span class="d3-sa">${id != null ? art(nm(id)) : ""}</span><span class="d3-sw"><span class="d3-sh"><b>${esc(name)}</b></span><small>${esc(c.nameOf(it.ctl))}${w.to ? ` → ${esc(w.to)}` : ""}</small>${text ? `<span class="d3-stt">${esc(text)}</span>` : ""}</span>`,
      };
    });
  }
  function centre(q) {
    const arming = !!c.ui().arm, head = arming ? "" : c.readHead(q), pr = $("d3prompt"), ph = $("d3phase"), st = $("d3stack");
    pr.hidden = !head;
    if (head && pr._h !== head) { pr.innerHTML = head; pr._h = head; pr.classList.remove("open"); }
    const items = stackItems();
    fresh = sync(st, items);
    st.hidden = !items.length;
    st.style.setProperty("--under", Math.max(0, items.length - 1));   // the spells under the top one, each a picture's width
    st.classList.toggle("flat", arming);                               // choosing a target: every spell just its picture
    ph.hidden = !!head || !!items.length || arming;
    if (!ph.hidden) fill(ph, `<b>${phaseWords()}</b><span class="d3-wait">${c.waitLine()}</span>`);
  }
  /** The step of the turn, whose (your bar has the turn's number). */
  function phaseWords() {
    const s = S();
    if (s.over || s.step === "mull") return c.headline();
    return `${c.isMe(s.active) ? "Your" : `${esc(c.nameOf(s.active))}’s`} ${(STEP_SHORT[s.step] || s.step).toLowerCase()}`;
  }
  /** The centre sits on the line between the halves (where the tipped plane puts it), between the two piles. */
  function place() {
    const fr = field.getBoundingClientRect();
    if (!fr.height) return;
    // the field's size, measured, for what's sized by it (the eye's distance, the card read, the question): container
    // units resolve as nothing in a container laid out late, a phone on its side with the page scrolling, and a plane
    // seen from no distance is a line
    field.style.setProperty("--fw", `${fr.width.toFixed(0)}px`);
    field.style.setProperty("--fh", `${fr.height.toFixed(0)}px`);
    const mr = $("d3mid").getBoundingClientRect(), lr = $("d3lib").getBoundingClientRect(), yr = $("d3yard").getBoundingClientRect();
    field.style.setProperty("--mid-y", `${(mr.top + mr.height / 2 - fr.top).toFixed(1)}px`);
    field.style.setProperty("--mid-l", `${Math.max(0, lr.right - fr.left).toFixed(1)}px`);
    field.style.setProperty("--mid-r", `${Math.max(0, fr.right - yr.left).toFixed(1)}px`);
  }

  // ---------- a card read: tapped, in the middle (tap it to put it down); pointed at, beside the table ----------
  function look() {
    const u = c.ui(), tapped = u.arm || asked ? null : u.look?.id ?? null, id = tapped ?? (c.POINTER && overCard ? c.hover() : null);
    if (id == null || !S()) { lookEl.hidden = true; lookEl._k = ""; return; }
    const k = `${id}:${tapped != null}:${lastKey}`;
    lookEl.hidden = false;
    lookEl.className = `d3-look${tapped == null ? ` peek ${pointerX > innerWidth / 2 ? "left" : "right"}` : ""}`;
    lookEl.tabIndex = tapped == null ? -1 : 0;
    if (lookEl._k !== k) { lookEl.innerHTML = bigCard(id); lookEl._k = k; }
  }

  // ---------- your hand, fanned ----------
  function hand(q) {
    const v = c.view(), s = S();
    if (v.seat == null) {
      handBox.className = "dd-hand d3-hand watch";
      handBox.innerHTML = `<p class="dd-watching">Watching: you sit down at the next game.</p>`;
      return;
    }
    const u = c.ui(), ring = c.rings(), ids = c.handOrder(s.hand[v.seat]), n = ids.length;
    const usable = new Set(c.moves().filter(m => m.from !== "yard").map(m => DECK[m.card]));
    const step = Math.min(2.6, 11 / Math.max(1, n));   // degrees between neighbours: a wider fan for fewer cards
    sync(handBox, ids.map((id, i) => {
      const pick = u.picks.indexOf(id), off = i - (n - 1) / 2;
      return {
        key: `h${id}`,
        cls: `d3-slot hand ${defOf(id).type}${usable.has(DECK[id]) ? " can" : c.fetchable().has(DECK[id]) ? " fetch" : ""}${u.look?.id === id ? " look" : ""}${pick >= 0 ? " sel" : ""}${ring.has(`c:${id}`) ? " advised" : ""}`,
        attrs: { "data-card": id, "aria-label": DECK[id] },
        vars: { "--r": `${(off * step).toFixed(2)}deg`, "--y": `${(off * off * 0.05).toFixed(3)}rem` },
        html: heldFace(id, pick >= 0 ? (q?.ordered ? pick + 1 : "✓") : ""),
      };
    }));
    handBox.className = `dd-hand d3-hand${c.canAct() ? " act" : ""}`;
    handBox.style.setProperty("--n", n);   // held sideways the hand is as wide as its cards (a grid can't ask a fan)
  }

  // ---------- arrows: a spell to what it's aimed at, a blocker to what it blocks ----------
  function lines() {
    const s = S(), u = c.ui(), o = field.getBoundingClientRect(), g = $("d3arrows").lastElementChild;
    const mid = el => {
      const r = el && (el.querySelector(".d3-face, .d3-pc") || el).getBoundingClientRect();
      return r && r.width ? { x: r.left + r.width / 2 - o.left, y: r.top + r.height / 2 - o.top, w: r.width, h: r.height } : null;
    };
    const of = t => box.querySelector(t.k === "g" ? "#d3yard" : `[data-tk="${c.targetKey(t)}"]`);
    const out = [];
    for (const it of s.stack) for (const t of it.targets || []) {
      const a = mid(box.querySelector(`.d3-st[data-sid="${it.sid}"]`)), b = mid(of(t));
      if (a && b) out.push(arrow(a, b, c.isMe(it.ctl) ? "mine" : "theirs"));
    }
    for (const [x, y] of [...(s.combat?.blk || []), ...u.blk]) {
      const a = mid(mat.querySelector(`[data-perm="${x}"]`)), b = mid(mat.querySelector(`[data-perm="${y}"]`));
      if (a && b) out.push(arrow(a, b, "block"));
    }
    g.innerHTML = out.join("");
  }
  /** Where a line from a box's middle toward a point leaves the box. */
  function edge(r, px, py) {
    const dx = px - r.x, dy = py - r.y, k = Math.min(Math.abs(r.w / 2 / (dx || 1e-6)), Math.abs(r.h / 2 / (dy || 1e-6)), 1);
    return { x: r.x + dx * k, y: r.y + dy * k };
  }
  /** A curve from one card's edge to another's, its head on the second; a ring round the second's middle. */
  function arrow(a, b, kind) {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, bend = Math.min(44, len * 0.2);
    const cx = (a.x + b.x) / 2 - ((b.y - a.y) / len) * bend, cy = (a.y + b.y) / 2 + ((b.x - a.x) / len) * bend;
    const s = edge(a, cx, cy), e = edge({ ...b, w: b.w + 6, h: b.h + 6 }, cx, cy), f = n => n.toFixed(1);
    return `<path class="${kind}" d="M${f(s.x)} ${f(s.y)}Q${f(cx)} ${f(cy)} ${f(e.x)} ${f(e.y)}" marker-end="url(#d3-head-${kind})"/><circle class="${kind}" cx="${f(b.x)}" cy="${f(b.y)}" r="${f(Math.min(14, Math.min(b.w, b.h) / 3))}"/>`;
  }

  // ---------- motion: what moved since the last state, flown or slid from where it was ----------
  const moving = () => !still?.matches && !document.hidden && !c.quiet;
  /** A card's face on screen, as an upright card (a tapped one's box turned back). */
  function faceBox(el) {
    const r = (el.querySelector(".d3-face, .d3-sa, .d3-pc, .d3-back") || el).getBoundingClientRect();
    if (!r.width) return null;
    const turned = el.classList.contains("tapped"), w = turned ? r.height : r.width, h = turned ? r.width : r.height;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w, h };
  }
  const centred = r => (r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null);
  /** Where a card in a zone shows, when it has no element of its own: the piles, their hand, yours, the stack. */
  function anchors() {
    const me = c.view().seat ?? 0, pc = id => $(id).querySelector(".d3-pc");
    return { l: centred(pc("d3lib").getBoundingClientRect()), y: centred(pc("d3yard").getBoundingClientRect()), st: centred($("d3centre").getBoundingClientRect()),
      [`h${me}`]: centred(handBox.getBoundingClientRect()), [`h${1 - me}`]: centred(box.querySelector(".d3-fan")?.getBoundingClientRect()) };
  }
  /** Each slot's place in its own frame (the plane's, or the hand's), where a slide is measured. */
  function places() {
    const m = new Map();
    for (const el of [...mat.querySelectorAll(".d3-slot"), ...handBox.querySelectorAll(".d3-slot")]) {
      let x = 0, y = 0;
      for (let e = el; e && e !== mat && e !== handBox; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
      m.set(el.dataset.k, { x, y, el });
    }
    return m;
  }
  /** The screen as it was, before a new state is drawn: each card's face, the zones' places, each slot's place. */
  function snapshot() {
    const at = new Map();
    for (const el of mat.querySelectorAll(".d3-slot[data-perm]")) at.set(Number(el.dataset.perm), faceBox(el));
    for (const el of handBox.querySelectorAll(".d3-slot[data-card]")) at.set(Number(el.dataset.card), faceBox(el));
    for (const el of box.querySelectorAll(".d3-fc[data-id]")) at.set(Number(el.dataset.id), faceBox(el));
    for (const el of box.querySelectorAll(".d3-st[data-sid]")) { const id = last?.stack.get(Number(el.dataset.sid)); if (id != null && !at.has(id)) at.set(id, faceBox(el)); }
    return { at, anchor: anchors(), places: places() };
  }
  /** Whether a card in a zone is face up to you. */
  function seen(s, id, z, me) {
    if (z === "bf" || z === "st" || z === "y" || z === "x" || z === `h${me}`) return true;
    return z === "l" || z === `h${1 - me}` ? c.sees() && !!(knOf(s, id) & (1 << me)) : false;
  }
  function animate(before, was, s) {
    // the slots that stayed slide from where they were (a row that grew or shrank, a land untapped into its pile)
    for (const [k, p] of places()) {
      const o = before.places.get(k);
      if (!o || (Math.abs(o.x - p.x) < 1 && Math.abs(o.y - p.y) < 1)) continue;
      p.el.animate([{ transform: `translate(${o.x - p.x}px, ${o.y - p.y}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: EASE });
    }
    // the cards that changed zone fly there: drawn, played, cast, countered, sent to the graveyard or back to the library
    const me = c.view().seat ?? 0, now = anchors(), list = moved(was, zonesOf(s)).slice(-MOST_FLIGHTS);
    list.forEach((m, i) => {
      const el = m.to === "bf" ? mat.querySelector(`.d3-slot[data-perm="${m.id}"]`) : m.to === `h${me}` ? handBox.querySelector(`.d3-slot[data-card="${m.id}"]`)
        : m.to === "st" ? [...box.querySelectorAll(".d3-st[data-sid]")].find(e => S().stack.find(it => it.sid === Number(e.dataset.sid))?.card === m.id)
        : m.to === `h${1 - me}` ? box.querySelector(`.d3-fc[data-id="${m.id}"]`) : null;
      const a = before.at.get(m.id) || (m.from && before.anchor[m.from]), b = (el && faceBox(el)) || (m.to && now[m.to]);
      if (!a) return;
      if (!b) { vanish(a, m.id); return; }                     // into exile, or a token gone: it fades where it was
      fly(m.id, a, b, el, seen(s, m.id, m.from, me), seen(s, m.id, m.to, me), list.length > 4 ? i * 60 : 0);
    });
  }
  /** A card flown from one place to another, turning over on the way where it's hidden at one end. */
  function fly(id, a, b, el, up0, up1, delay) {
    const fit = r => { const h = Math.min(r.h, r.w / 0.72); return { w: h * 0.72, h, x: r.x, y: r.y }; };
    const A = fit(a), B = fit(b), g = document.createElement("div");
    g.className = "d3-ghost";
    g.innerHTML = `<div class="d3-gin">${up0 || up1 ? `<div class="d3-gf">${flyingFace(id)}</div>` : ""}<div class="d3-gb">${back()}</div></div>`;
    const at = r => ({ left: `${r.x - r.w / 2}px`, top: `${r.y - r.h / 2}px`, width: `${r.w}px`, height: `${r.h}px` });
    Object.assign(g.style, at(A));
    fx.append(g);
    if (el) { el.classList.add("d3-coming"); el._flying = true; }
    const t = { duration: FLY_MS, delay, easing: EASE, fill: "both" };
    const turn = x => `rotateY(${x ? 0 : 180}deg)`;
    g.firstElementChild.animate([{ transform: `${turn(up0)} scale(1)` }, { transform: `rotateY(${up0 === up1 ? (up0 ? 0 : 180) : 90}deg) scale(1.18)`, offset: 0.5 }, { transform: `${turn(up1)} scale(1)` }], t);
    g.animate([at(A), at(B)], t).onfinish = () => {
      g.remove();
      if (!el) return;
      el.classList.remove("d3-coming");
      el._flying = false;
      el.querySelector(".d3-face, .d3-sa")?.animate([{ scale: 1.14 }, { scale: 1 }], { duration: 220, easing: "ease-out" });
    };
  }
  function vanish(a, id) {
    const g = document.createElement("div");
    g.className = "d3-ghost";
    g.innerHTML = `<div class="d3-gin"><div class="d3-gf">${flyingFace(id)}</div></div>`;
    Object.assign(g.style, { left: `${a.x - a.w / 2}px`, top: `${a.y - a.h / 2}px`, width: `${a.w}px`, height: `${a.h}px` });
    fx.append(g);
    g.animate([{ opacity: 1, scale: 1, filter: "brightness(1)" }, { opacity: 0, scale: 1.3, filter: "brightness(2)" }], { duration: 520, easing: "ease-out", fill: "both" }).onfinish = () => g.remove();
  }
  /** Life gained or lost, over the avatar. */
  function floater(seat, d) {
    const av = box.querySelector(`.d3-av[data-tk="p:${seat}"]`), r = av?.getBoundingClientRect();
    if (!r?.width) return;
    const f = document.createElement("div");
    f.className = `d3-floater ${d < 0 ? "hurt" : "heal"}`;
    f.textContent = d > 0 ? `+${d}` : `−${-d}`;
    Object.assign(f.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` });
    fx.append(f);
    f.animate([{ opacity: 0, transform: "translate(-50%, -50%) scale(.5)" }, { opacity: 1, transform: "translate(-50%, -120%) scale(1.2)", offset: 0.22 }, { opacity: 0, transform: "translate(-50%, -260%) scale(1)" }],
      { duration: 1500, easing: "ease-out" }).onfinish = () => f.remove();
    av.animate([{ scale: 1 }, { scale: 1.16 }, { scale: 1 }], { duration: 420, easing: "ease-out" });
    av.classList.add(d < 0 ? "hit" : "healed");
    setTimeout(() => av.classList.remove("hit", "healed"), 700);
  }
  /** A word across the table: whose turn it is now, the game's end (that one stays). */
  function banner(text, stay = false) {
    const b = $("d3banner");
    b.innerHTML = `<span>${esc(text)}</span>`;
    b.getAnimations().forEach(a => a.cancel());
    b.classList.toggle("stay", stay);
    if (stay || !moving()) return;
    b.animate([{ opacity: 0, letterSpacing: ".05em" }, { opacity: 1, letterSpacing: ".3em", offset: 0.25 }, { opacity: 1, offset: 0.7 }, { opacity: 0, letterSpacing: ".4em" }], { duration: 1500, easing: "ease-out" });
  }
  /** What changed since the last state, said: life gained or lost over the avatars, a new turn across the table. */
  function beats(s) {
    if (moving()) for (const seat of [0, 1]) { const d = s.life[seat] - last.life[seat]; if (d) floater(seat, d); }
    if (!s.over && s.step !== "mull" && (s.turn !== last.turn || s.active !== last.active)) banner(c.isMe(s.active) ? "Your turn" : `${c.nameOf(s.active)}’s turn`);
  }

  // ---------- the whole ----------
  function empty() {
    for (const r of Object.values(rows)) r.replaceChildren();
    fill($("d3foe"), "");
    fill($("d3me"), "");
    fill($("d3lib"), `<span class="d3-pc">${back()}</span><b class="d3-n">80</b><small>Library</small>`);
    fill($("d3yard"), `<span class="d3-pc"></span><b class="d3-n">0</b><small>Graveyard</small>`);
    $("d3stack").replaceChildren();
    $("d3stack").hidden = true;
    $("d3prompt").hidden = false;
    $("d3prompt").innerHTML = $("d3prompt")._h = `<p class="dd-lead">One deck of eighty cards, one library, one graveyard, shared. Win with Dandâns, which can only attack across an Island.</p>`;
    $("d3phase").hidden = true;
    lookEl.hidden = true;
    handBox.replaceChildren();
    handBox.className = "dd-hand d3-hand";
    $("d3arrows").lastElementChild.innerHTML = "";
    banner("", false);
    last = null;
    lastKey = "";
    place();
  }
  /** Draw the table: q is the question put to you now (dandan.js's question()). */
  function draw(q) {
    const v = c.view(), s = v?.G ? v.state : null;
    if (!s) { empty(); return; }
    const key = `${v.G.seq}:${v.G.n}`, changed = key !== lastKey;
    // a new game's deal flies from the library too: its hands dealt from the one pile
    const dealt = changed && last && last.game !== v.G.seq && s.step === "mull";
    const was = dealt ? new Map(DECK.map((_, id) => [id, "l"])) : last?.game === v.G.seq ? last.zones : null;
    const before = changed && was && moving() ? snapshot() : null;
    asked = !!q;
    bars();
    const me = v.seat ?? 0;
    sync(rows.fl, landItems(1 - me));
    sync(rows.fc, creItems(1 - me, q));
    drawPiles();
    sync(rows.mc, creItems(me, q));
    sync(rows.ml, landItems(me));
    centre(q);
    hand(q);
    look();
    place();
    lines();
    if (before) {
      animate(before, was, s);
      for (const el of fresh) if (!el._flying) el.animate([{ opacity: 0, scale: .7 }, { opacity: 1, scale: 1 }], { duration: 260, easing: EASE });
    }
    if (changed && last?.game === v.G.seq) beats(s);
    // the game's end stays across the table (a game opened already over too); a new one takes it away
    const stays = $("d3banner").classList.contains("stay");
    if (s.over && !stays) banner(c.headline(), true);
    else if (!s.over && stays) banner("", false);
    if (changed) last = { game: v.G.seq, zones: zonesOf(s), life: [...s.life], turn: s.turn, active: s.active, over: s.over, stack: new Map(s.stack.map(it => [it.sid, it.card])) };
    lastKey = key;
  }

  // the centre and the arrows follow the screen as it turns or resizes; a card pointed at is read on the far side from the pointer
  new ResizeObserver(() => { if (!box.hidden && S()) { place(); lines(); } }).observe(field);
  // a question's words are cut to two lines over the table, the whole of them a tap away
  $("d3prompt").addEventListener("click", e => { if (!e.target.closest("button")) { $("d3prompt").classList.toggle("open"); place(); } });
  addEventListener("pointermove", e => { pointerX = e.clientX; }, { passive: true });
  // a card pointed at is read while the pointer is on it (the table view keeps the last one in its reading box; here
  // it would stand over the table)
  document.addEventListener("pointerover", e => {
    if (e.pointerType === "touch") return;
    const on = !!e.target.closest?.("[data-card], [data-perm], [data-sid], [data-look], [data-qc]");
    if (on !== overCard) { overCard = on; if (!box.hidden) look(); }
  });
  // reset: the view shown again after the table view, whose moves it didn't see go (none are flown)
  return { draw, read: look, empty, reset: () => { last = null; lastKey = ""; } };
}
