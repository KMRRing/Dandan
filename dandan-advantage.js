// Dandan's review of how a game went, for the end of it: who was ahead after each action that finished resolving, as the
// judge (dandan-eval.js) reads it, drawn as a chart of the game's advantage and disadvantage by action and by turn, with
// the moves that cost the most picked out; and the record of games won, by whom they were played against. The engine
// notes the chance as the game is played (`noteAction`, in settle) and the rules at each turn's start (`noteTurn`), in the
// state's `adv`, so it is the same on both phones at a table and survives a reload; the page draws it. Pure, no page:
// tests/dandan-advantage.mjs.
import { winChance } from "./dandan-eval.js";

// ---------- noting it as the game is played ----------
// An entry of the state's `adv` is one number: the database drops nulls from a list, so a list of pairs would lose its
// place, and a list of these can't. A turn's start (the first decision of a turn, where the judge was learned) is turn ×
// 1000 + percent; an action settled (kind 1), and every start since actions were noted, adds who made it (the seat whose
// spell resolved, land came down or Dandân attacked) and the place in the log it had reached, to find the words by:
// (turn × 1000 + percent) × 400000 + (kind × 2 + seat) × 100000 + log place. A game from before has only the first
// kind, under 400,000,000, and is read as it was.
const OLD = 4e8, STEP = 4e5, PLACE = 1e5;
/** An entry: `at` ({ kind: 0 start | 1 action, by: seat, ln: log place }) for a new one, none for the old kind. */
export const pack = (turn, pct, at) => (at ? (turn * 1000 + pct) * STEP + (at.kind * 2 + at.by) * PLACE + Math.min(PLACE - 1, at.ln) : turn * 1000 + pct);
export function unpack(v) {
  if (v < OLD) return { turn: Math.floor(v / 1000), pct: v % 1000, kind: 0, by: null, ln: null };
  const base = Math.floor(v / STEP), code = Math.floor((v % STEP) / PLACE), kind = code >> 1;
  return { turn: Math.floor(base / 1000), pct: base % 1000, kind, by: kind ? code & 1 : null, ln: v % PLACE };
}
const chanceOf = s => Math.round(winChance(s, 0) * 100);
/** A turn has begun: seat 0's chance by the judge, in the state's `adv` (a turn is noted once; the judge was learned
 *  from the start of turns, so that is where it is asked). */
export function noteTurn(s) {
  const adv = (s.adv ||= []);
  for (let i = adv.length - 1; i >= 0; i--) {
    const u = unpack(adv[i]);
    if (u.turn < s.turn) break;
    if (u.kind === 0 && u.turn === s.turn) return;
  }
  adv.push(pack(s.turn, chanceOf(s), { kind: 0, by: 0, ln: s.ln }));
}
/**
 * An action has finished resolving (the stack empty, no question asked, the game on): the judge's chance now, and whose
 * action it was, if the log has moved since the last entry (a pass that only moves a step says nothing, and `after` is
 * where the turn's own line is, which is not an action). The judge, learned from the starts of turns, reads the
 * positions after an action as well (a log loss of 0.517 against 0.539 at the start of turns, 200 games of Medium
 * against Medium) and the ones with a spell still on the stack a little worse (0.550), which is why a spell is noted
 * once it has resolved. A game with no entry yet, or whose last is of the old kind (it has no log place), gets none.
 */
export function noteAction(s, by, after = 0) {
  const adv = s.adv;
  if (!adv?.length || s.over || s.pending || s.stack.length) return;
  const last = unpack(adv[adv.length - 1]);
  if (last.ln == null || s.ln <= Math.max(last.ln, after)) return;
  adv.push(pack(s.turn, chanceOf(s), { kind: 1, by, ln: s.ln }));
}
/** The log's lines from place `from` (not including it) to `to`. */
export const linesBetween = (log, from, to) => (log || []).filter(e => e.n > from && e.n <= to).map(e => e.t);

// ---------- the game's curve ----------
/** Whose turn it is (turns alternate, from the seat that went first). */
export const activeAt = (first, turn) => (turn % 2 === 1 ? first : 1 - first);
/** A fall in your chance of this many points or more, from a move of yours, is one to look at. */
export const MIN_FALL = 4;
/**
 * The game as the seat saw it: `points`, the chance of winning at each entry noted, in order ({ turn, you } in whole
 * percent, `kind` 0 a turn's start or 1 an action settled, `by` the seat that made it, `d` the change since the entry
 * before, `from` and `ln` the log places it covers, `pos` where it lies along the turns: a turn's entries are spread from
 * its number towards the next), and `end`, where it ended up (100 won, 0 lost, 50 both lost, null while it is on) at
 * `endAt`, the turn after the last. The biggest `swing` between two entries: of the actions when there are some (during
 * which turn, whose move), else of the turns' starts (during which turn, whose turn it was).
 */
export function curveOf(s, seat) {
  const points = [], seen = new Set();
  let prev = null;
  for (const v of s.adv || []) {
    const u = unpack(v);
    if (u.kind === 0) { if (seen.has(u.turn)) continue; seen.add(u.turn); }
    const you = seat === 0 ? u.pct : 100 - u.pct;
    points.push({ turn: u.turn, you, kind: u.kind, by: u.kind ? u.by : null, ln: u.ln, from: prev?.ln ?? 0, d: prev ? you - prev.you : 0, pos: u.turn });
    prev = { ln: u.ln, you };
  }
  // an entry's place along its turn: the first on the turn's number, the rest evenly to the next turn's
  for (let i = 0, j; i < points.length; i = j) {
    for (j = i; j < points.length && points[j].turn === points[i].turn; j++);
    for (let k = i; k < j; k++) points[k].pos = points[i].turn + (k - i) / (j - i);
  }
  const end = s.over ? (s.winner < 0 ? 50 : s.winner === seat ? 100 : 0) : null;
  const moves = points.filter(p => p.kind === 1);
  let swing = null;
  if (moves.length) {
    for (const p of moves) if (!swing || Math.abs(p.d) > Math.abs(swing.delta)) swing = { turn: p.turn, by: p.by, from: p.you - p.d, to: p.you, delta: p.d, move: true };
  } else {
    for (let i = 1; i < points.length; i++) {
      const delta = points[i].you - points[i - 1].you;
      if (!swing || Math.abs(delta) > Math.abs(swing.delta)) swing = { turn: points[i - 1].turn, by: activeAt(s.first, points[i - 1].turn), from: points[i - 1].you, to: points[i].you, delta, move: false };
    }
  }
  return { points, end, endAt: Math.max(s.turn, points.at(-1)?.turn || 0) + 1, seat, first: s.first, swing };
}
/** A chart is worth drawing from two turns' starts. */
export const worthDrawing = c => c.points.filter(p => p.kind === 0).length >= 2;
/** Whether there is more than the turns to show: actions noted. */
export const hasActions = c => c.points.some(p => p.kind === 1);
/** The curve as one point to a turn, at each turn's start (what the chart was before actions were noted). */
export const byTurn = c => ({ ...c, points: c.points.filter(p => p.kind === 0).map(p => ({ ...p, pos: p.turn })) });
/**
 * The moves that cost the most: the actions after which your chance fell furthest, your own and the other's apart (the
 * most `limit` of each, a fall of MIN_FALL points or more), each with its place `i` in the curve's points, worst first.
 * What the draw and the untap of a turn's start do isn't a move, so isn't here.
 */
export function momentsOf(c, { limit = 3 } = {}) {
  const falls = c.points.map((p, i) => ({ ...p, i })).filter(p => p.kind === 1 && p.d <= -MIN_FALL);
  const worst = who => falls.filter(p => p.by === who).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, limit);
  return { mine: worst(c.seat), theirs: worst(1 - c.seat) };
}

// ---------- in words ----------
/** "your" or "Gill's": whose turn or move, in words. */
const whose = (names, seat, seatYou) => (seat === seatYou ? "your" : `${names[seat]}'s`);
const signed = d => `${d < 0 ? "−" : "+"}${Math.abs(d)}`;
/** The chart's caption: how long you were ahead, the lowest and the highest, and the biggest swing. */
export function captionOf(c, names) {
  if (!worthDrawing(c)) return "";
  const turns = c.points.filter(p => p.kind === 0), ahead = turns.filter(p => p.you > 50).length, n = turns.length;
  const low = c.points.reduce((a, p) => (p.you < a.you ? p : a)), high = c.points.reduce((a, p) => (p.you > a.you ? p : a));
  const out = [`Ahead at the start of ${ahead} of ${n} turns.`];
  if (c.end === 100 && low.you < 50) out.push(`Won from as low as ${low.you}% (turn ${low.turn}).`);
  else if (c.end === 0 && high.you > 50) out.push(`Lost from as high as ${high.you}% (turn ${high.turn}).`);
  const w = c.swing;
  if (w && Math.abs(w.delta) >= 5) out.push(`Biggest swing: ${w.move ? `turn ${w.turn}, ${whose(names, w.by, c.seat)} move` : `during turn ${w.turn} (${whose(names, w.by, c.seat)} turn)`}, ${w.delta > 0 ? "up" : "down"} ${Math.abs(w.delta)} points, ${w.from}% to ${w.to}%.`);
  return out.join(" ");
}
/** What a tapped point says: i the point's place (the last, past the points, is the end); `said` the log's words for an action. */
export function readoutOf(c, i, names, said = []) {
  if (i >= c.points.length) return c.end == null ? "" : `The game's end: ${c.end === 100 ? "you won" : c.end === 0 ? `${names[1 - c.seat]} won` : "a draw"}.`;
  const p = c.points[i];
  if (p.kind === 1) return `Turn ${p.turn}, ${whose(names, p.by, c.seat)} move: you ${p.you - p.d}% to ${p.you}% (${signed(p.d)}).${said.length ? ` ${said.join("; ").replace(/([^.…])$/, "$1.")}` : ""}`;
  return `Start of turn ${p.turn}, ${whose(names, activeAt(c.first, p.turn), c.seat)} turn: you ${p.you}%, ${names[1 - c.seat]} ${100 - p.you}%.`;
}

// ---------- the chart ----------
// Drawn to a 320 × 124 box, whatever size it's shown at: your chance up the side (the top is certain victory, the line
// across is even, the bottom certain defeat), the turns across, each turn's start a dot on the line and each action after
// it a smaller one; the area between the line and even is verdigris above it and oxblood below (clipped, so a crossing is
// exact), and the game's end is where the dashed line stops. The moves that cost you most are ringed and numbered.
export const BOX = { w: 320, h: 124, l: 30, r: 310, t: 10, b: 100 };
const X = (c, pos) => {
  const lo = c.points[0].pos, span = Math.max(1, c.endAt - lo);
  return BOX.l + ((pos - lo) / span) * (BOX.r - BOX.l);
};
const Y = pct => BOX.t + ((100 - pct) / 100) * (BOX.b - BOX.t);
const f = n => Math.round(n * 10) / 10;
/** The place of a point (0 to the last noted, then the end), for a tap at x in the box. */
export function pointAt(c, x) {
  const xs = [...c.points.map(p => X(c, p.pos)), ...(c.end == null ? [] : [X(c, c.endAt)])];
  return xs.reduce((best, px, i) => (Math.abs(px - x) < Math.abs(xs[best] - x) ? i : best), 0);
}
/** The chart as SVG markup, with point `sel` marked (-1 for none) and `flags` ([point's place, number]) ringed. */
export function chartSvg(c, sel = -1, flags = []) {
  if (!worthDrawing(c)) return "";
  const pts = c.points.map(p => [X(c, p.pos), Y(p.you)]), mid = Y(50);
  const line = pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
  const area = `M${f(pts[0][0])},${f(mid)} ${pts.map(([x, y]) => `L${f(x)},${f(y)}`).join(" ")} L${f(pts.at(-1)[0])},${f(mid)} Z`;
  const endX = X(c, c.endAt), endY = c.end == null ? null : Y(c.end);
  const label = (i, turn) => `<text x="${f(X(c, c.points[i].pos))}" y="${BOX.h - 6}" text-anchor="middle" font-size="9" class="dd-adv-x${i === sel ? " on" : ""}">${turn}</text>`;
  // a label to every few turns where there are many (games run to forty turns): twelve at the most, and the end (a turn's
  // label too near it is left out, or the two would run into one word)
  const starts = c.points.map((p, i) => [p, i]).filter(([p]) => p.kind === 0);
  const step = Math.ceil(starts.length / 12), first = starts[0][0].turn, small = starts.length > 30, many = c.points.length > 90;
  const grid = [0, 25, 50, 75, 100].map(p => `<line x1="${BOX.l}" x2="${BOX.r}" y1="${f(Y(p))}" y2="${f(Y(p))}" class="dd-adv-grid${p === 50 ? " mid" : ""}"/>`).join("");
  const ys = [[100, "100"], [50, "50"], [0, "0"]].map(([p, t]) => `<text x="${BOX.l - 5}" y="${f(Y(p) + 3)}" text-anchor="end" font-size="9" class="dd-adv-y">${t}</text>`).join("");
  const ticks = starts.map(([, i]) => `<line x1="${f(pts[i][0])}" x2="${f(pts[i][0])}" y1="${BOX.b}" y2="${BOX.b + 3}" class="dd-adv-tick"/>`).join("");
  const dots = c.points.map((p, i) => `<circle cx="${f(pts[i][0])}" cy="${f(pts[i][1])}" r="${i === sel ? 4 : p.kind ? (many ? 1 : 1.4) : small ? 1.7 : 2.4}" class="dd-adv-dot${p.kind ? " act" : ""}${i === sel ? " on" : ""}"/>`).join("");
  const rings = flags.map(([i, n]) => {
    const [x, y] = pts[i], up = y - BOX.t > 16;
    return `<circle cx="${f(x)}" cy="${f(y)}" r="5.2" class="dd-adv-flag"/><text x="${f(x)}" y="${f(up ? y - 8 : y + 14)}" text-anchor="middle" font-size="9" class="dd-adv-num">${n}</text>`;
  }).join("");
  const ending = endY == null ? "" : `<line x1="${f(pts.at(-1)[0])}" y1="${f(pts.at(-1)[1])}" x2="${f(endX)}" y2="${f(endY)}" class="dd-adv-end"/>`
    + `<circle cx="${f(endX)}" cy="${f(endY)}" r="${sel === c.points.length ? 5 : 3.6}" class="dd-adv-fin ${c.end === 100 ? "won" : c.end === 0 ? "lost" : "drawn"}"/>`;
  const selX = sel < 0 ? null : sel < c.points.length ? pts[sel][0] : endX;
  const mark = selX == null ? "" : `<line x1="${f(selX)}" x2="${f(selX)}" y1="${BOX.t}" y2="${BOX.b}" class="dd-adv-sel"/>`;
  const turns = c.points.filter(p => p.kind === 0).length, acts = c.points.length - turns;
  return `<svg class="dd-adv" viewBox="0 0 ${BOX.w} ${BOX.h}" role="img" aria-label="${turns} turns${acts ? ` and ${acts} actions` : ""}: your chance of winning at the start of each turn${acts ? " and after each action" : ""}, from ${c.points[0].you}% to ${c.points.at(-1).you}%${c.end == null ? "" : c.end === 100 ? ", and you won" : c.end === 0 ? ", and you lost" : ", and it was a draw"}">`
    + `<defs><clipPath id="ddAdvUp"><rect x="0" y="0" width="${BOX.w}" height="${f(mid)}"/></clipPath><clipPath id="ddAdvDown"><rect x="0" y="${f(mid)}" width="${BOX.w}" height="${BOX.h}"/></clipPath></defs>`
    + grid + `<path d="${area}" class="dd-adv-up" clip-path="url(#ddAdvUp)"/><path d="${area}" class="dd-adv-down" clip-path="url(#ddAdvDown)"/>`
    + mark + `<polyline points="${line}" class="dd-adv-line"/>` + ending + dots + rings + ticks + ys
    + `<text x="${BOX.l + 4}" y="${BOX.t + 9}" font-size="8" class="dd-adv-side">you ahead</text><text x="${BOX.l + 4}" y="${BOX.b - 4}" font-size="8" class="dd-adv-side">you behind</text>`
    + starts.map(([p, i]) => ((p.turn - first) % step === 0 && (c.end == null || endX - pts[i][0] >= 18) ? label(i, p.turn) : "")).join("")
    + (c.end == null ? "" : `<text x="${f(endX)}" y="${BOX.h - 6}" text-anchor="middle" font-size="9" class="dd-adv-x${sel === c.points.length ? " on" : ""}">End</text>`)
    + `</svg>`;
}

// ---------- the record ----------
/** Who a game was played against, in the order the record lists them. */
export const OPPONENTS = [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["friend", "A friend"]];
export const emptyRecord = () => ({ played: 0, won: 0, by: {}, last: "" });
/** The record as it stands (an older one has only what was played and won), with a game's result added: `vs` one of
 *  OPPONENTS' keys; a draw counts as played and not won. The last twenty results are kept, newest last: W, L or D.
 *  `game` says which game it was (when it began): the one counted last isn't counted again, and the record handed back
 *  is then the very one given, so a caller can tell. */
export function addResult(rec, { won, drawn = false, vs, game }) {
  if (game != null && rec?.game === game) return rec;
  const r = { ...emptyRecord(), ...rec, by: { ...(rec?.by || {}) } };
  if (game != null) r.game = game;
  r.played++;
  if (won) r.won++;
  if (vs) { const [p, w] = r.by[vs] || [0, 0]; r.by[vs] = [p + 1, w + (won ? 1 : 0)]; }
  r.last = `${r.last}${won ? "W" : drawn ? "D" : "L"}`.slice(-20);
  return r;
}
const pct = (w, p) => (p ? Math.round((100 * w) / p) : 0);
/** The record in words and rows: the total, a row for each kind of opponent played (and the games from before they were
 *  counted), and the last ten results, newest last. */
export function recordOf(rec) {
  const r = { ...emptyRecord(), ...rec };
  const rows = OPPONENTS.filter(([k]) => r.by?.[k]?.[0]).map(([k, label]) => ({ key: k, label, played: r.by[k][0], won: r.by[k][1], pct: pct(r.by[k][1], r.by[k][0]) }));
  const counted = rows.reduce((a, x) => a + x.played, 0), wonCounted = rows.reduce((a, x) => a + x.won, 0);
  if (r.played > counted) rows.push({ key: "earlier", label: "Earlier games", played: r.played - counted, won: r.won - wonCounted, pct: pct(r.won - wonCounted, r.played - counted) });
  return { played: r.played, won: r.won, pct: pct(r.won, r.played), rows, last: [...r.last.slice(-10)] };
}
