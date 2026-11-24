// The Swiss and German packs' cards, drawn as vectors (Jass, Schafkopf without its pictures; trumps-cards.js `packCard`): a rank
// and a small suit in the corner, and in the field the suit's pips (6 to 9), the Banner (the Swiss ten) or ten pips (German),
// a big suit for the ace, and for the Under, the Ober and the King a half-length figure in the suit's colours, the suit in its
// hand. One card is one SVG of 100 by 140 units, drawn on the suite's own card (cards.css), so size, edge and shadow are its own.

const INK = "#2A1F14", EDGE = "#7A5A22", SKIN = "#F0C9A0";
let ids = 0;

/** The suits, drawn about their own middle (40 units across), in the colours of the pack. */
const EMBLEM = {
  bell: `<path d="M0-19.5a3.4 3.4 0 1 1 .01 0" fill="none" stroke="#5A3A12" stroke-width="2"/><circle cy="2" r="15" fill="#E1A82E" stroke="#5A3A12" stroke-width="2"/>
    <path d="M-12.5-6a13.4 13.4 0 0 1 9-7" fill="none" stroke="#FFF3C4" stroke-width="2.6" stroke-linecap="round" opacity=".8"/>
    <path d="M-14.3-3.2Q0 1 14.3-3.2" fill="none" stroke="#B3302A" stroke-width="3"/><path d="M-14.7 6.4Q0 10.8 14.7 6.4V9.6Q0 14 -14.7 9.6Z" fill="#5A3A12"/><circle cy="15.4" r="2.3" fill="#5A3A12"/>`,
  shield: (id => `<clipPath id="${id}"><path d="M-15-17H15V2C15 12 8 17 0 21-8 17-15 12-15 2Z"/></clipPath><path d="M-15-17H15V2C15 12 8 17 0 21-8 17-15 12-15 2Z" fill="#E1A82E"/>
    <path clip-path="url(#${id})" d="M-17-19 6-19 17 4 17 12 4 22Z" fill="#B3302A"/><path d="M-15-17H15V2C15 12 8 17 0 21-8 17-15 12-15 2Z" fill="none" stroke="#3B2A12" stroke-width="2" stroke-linejoin="round"/>
    <path d="M-11.5-13.5H-4" stroke="#FFF3C4" stroke-width="2" stroke-linecap="round" opacity=".7"/>`),
  rose: `<g fill="#2F7D3B" stroke="#1B4A22" stroke-width="1"><path d="M0-19 4-7-4-7Z" transform="rotate(36)"/><path d="M0-19 4-7-4-7Z" transform="rotate(108)"/><path d="M0-19 4-7-4-7Z" transform="rotate(180)"/><path d="M0-19 4-7-4-7Z" transform="rotate(252)"/><path d="M0-19 4-7-4-7Z" transform="rotate(324)"/></g>
    <g fill="#C2312A" stroke="#6E1610" stroke-width="1.4"><circle cx="0" cy="-9.2" r="7.4"/><circle cx="8.8" cy="-2.8" r="7.4"/><circle cx="5.4" cy="7.4" r="7.4"/><circle cx="-5.4" cy="7.4" r="7.4"/><circle cx="-8.8" cy="-2.8" r="7.4"/></g>
    <g fill="none" stroke="#8E1E18" stroke-width="1"><path d="M-3-12q3 2 6 0M6-4q0 3-3 5M3 11q-3-2-2-5M-3 11q3-2 2-5M-6-4q0 3 3 5" opacity=".7"/></g>
    <circle r="5.2" fill="#E8C24A" stroke="#6E1610" stroke-width="1.2"/><g fill="#8A5A0C"><circle cx="-1.6" cy="-1.4" r=".8"/><circle cx="1.8" cy="-1" r=".8"/><circle cx="0" cy="1.8" r=".8"/></g>`,
  acorn: `<path d="M0-18.5v-3" stroke="#4A3016" stroke-width="2" stroke-linecap="round"/><path d="M0-19C6-24 12-22 12-22 11-17 6-15 0-18Z" fill="#3E8E3A" stroke="#1E4A1C" stroke-width="1"/>
    <path d="M-12.4-1H12.4C12.4 12 6 20 0 21.5-6 20-12.4 12-12.4-1Z" fill="#D9A441" stroke="#5A3A12" stroke-width="2" stroke-linejoin="round"/>
    <path d="M-8 3C-8 10-5 15-2.4 17.6" fill="none" stroke="#FFF0B0" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>
    <path d="M-14-1C-14-12-7-18.5 0-18.5S14-12 14-1Z" fill="#7A5226" stroke="#3A2410" stroke-width="2" stroke-linejoin="round"/>
    <path d="M-9-10 9-10M-12-6 12-6M-6-14 6-14" stroke="#3A2410" stroke-width=".9" opacity=".55"/>`,
  heart: `<path d="M0 19C-14 9-18 1-18-6A9.6 9.6 0 0 1 0-10 9.6 9.6 0 0 1 18-6C18 1 14 9 0 19Z" fill="#C2312A" stroke="#6E1610" stroke-width="2" stroke-linejoin="round"/><path d="M-12-8A6 6 0 0 1-6-12" fill="none" stroke="#FFD6CF" stroke-width="2.6" stroke-linecap="round" opacity=".7"/>`,
  leaf: `<path d="M0 21V8M0-19C-14-9-17 5 0 14 17 5 14-9 0-19Z" fill="#3E8E3A" stroke="#1E4A1C" stroke-width="2" stroke-linejoin="round"/><path d="M0-14V12M0-6-6-12M0 1-7-5M0-6 6-12M0 1 7-5" fill="none" stroke="#1E4A1C" stroke-width="1.2"/><path d="M-8-6C-6-10-4-13-3-14" fill="none" stroke="#B9E5A8" stroke-width="2" stroke-linecap="round" opacity=".6"/>`,
};
const KIND = { swiss: ["bell", "shield", "rose", "acorn"], german: ["bell", "heart", "leaf", "acorn"] };
/** Each suit's ink (the corner), tint (the field) and figures' colours (tunic, trim, hat). */
const LOOKS = {
  bell: { ink: "#8A4B0C", tint: "#F9EBC4", tunic: "#B3302A", trim: "#E1A82E", hat: "#E1A82E", feather: "#C2312A" },
  shield: { ink: "#1F4E8C", tint: "#E6EDF6", tunic: "#2D5B8C", trim: "#E1A82E", hat: "#B3302A", feather: "#F4F0E2" },
  rose: { ink: "#9C2620", tint: "#F8E6E0", tunic: "#C9892B", trim: "#2F7D3B", hat: "#2F7D3B", feather: "#C2312A" },
  acorn: { ink: "#2E5E2A", tint: "#EDF1D8", tunic: "#4F7A3A", trim: "#D9A441", hat: "#7A5226", feather: "#E1A82E" },
  heart: { ink: "#9C2620", tint: "#F8E6E0", tunic: "#B3302A", trim: "#F4F0E2", hat: "#2D5B8C", feather: "#F4F0E2" },
  leaf: { ink: "#2E5E2A", tint: "#E7F1DC", tunic: "#3E8E3A", trim: "#E1A82E", hat: "#B3302A", feather: "#E1A82E" },
};
const emblem = (kind, x, y, s, rot = 0) => `<g transform="translate(${x} ${y}) scale(${s})${rot ? ` rotate(${rot})` : ""}">${typeof EMBLEM[kind] === "function" ? EMBLEM[kind](`s${ids++}`) : EMBLEM[kind]}</g>`;

/** Where the pips go, in the field (x 38 to 78, y 24 to 116). */
const L = 40, C = 58, R = 76;
const PIPS = {
  6: [[L, 28], [R, 28], [L, 70], [R, 70], [L, 112], [R, 112]],
  7: [[L, 28], [R, 28], [C, 49], [L, 70], [R, 70], [L, 112], [R, 112]],
  8: [[L, 28], [R, 28], [C, 49], [L, 70], [R, 70], [C, 91], [L, 112], [R, 112]],
  9: [[L, 26], [R, 26], [L, 54], [R, 54], [C, 70], [L, 86], [R, 86], [L, 114], [R, 114]],
  10: [[L, 26], [R, 26], [C, 40], [L, 54], [R, 54], [L, 86], [R, 86], [C, 100], [L, 114], [R, 114]],
};

/** A half-length figure (Under, Ober, King) about x = 58, in a suit's colours, the suit raised in front. */
function figure(rank, look, kind) {
  const o = look, beard = rank === "K" ? "#E9E4D6" : "#5A3A18", hair = rank === "J" ? "#8A5A22" : rank === "Q" ? "#3A2616" : "#C9C3B4";
  const hat = {
    // the Under: a feathered cap
    J: `<path d="M-17 44C-19 27 17 23 19 40 12 36-9 36-17 44Z" fill="${o.hat}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/><path d="M12 33C26 24 30 12 24 4 22 14 16 20 8 27Z" fill="${o.feather}" stroke="${INK}" stroke-width="1"/><path d="M-13 43C-18 50-17 56-15 60M13 43C18 50 17 56 15 60" fill="none" stroke="${hair}" stroke-width="5" stroke-linecap="round"/>`,
    // the Ober: a broad hat with a plume
    Q: `<ellipse cy="42" rx="27" ry="6" fill="${o.hat}" stroke="${INK}" stroke-width="1.2"/><path d="M-14 42C-15 22 15 22 14 42Z" fill="${o.hat}" stroke="${INK}" stroke-width="1.2"/><path d="M-14 38H14" stroke="${o.trim}" stroke-width="3.4"/><path d="M8 26C22 22 30 10 26 0 22 10 14 14 6 18Z" fill="${o.feather}" stroke="${INK}" stroke-width="1"/><path d="M-13 45C-17 52-16 58-14 62M13 45C17 52 16 58 14 62" fill="none" stroke="${hair}" stroke-width="5" stroke-linecap="round"/>`,
    // the King: a crown
    K: `<path d="M-15 44V24L-8 33 0 19 8 33 15 24V44Z" fill="#E1A82E" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/><path d="M-15 40H15" stroke="${INK}" stroke-width="1" opacity=".5"/><circle cx="-8" cy="35" r="2" fill="#B3302A"/><circle cx="0" cy="30" r="2.2" fill="#2D5B8C"/><circle cx="8" cy="35" r="2" fill="#B3302A"/><circle cx="-15" cy="23" r="2" fill="#F4F0E2"/><circle cx="0" cy="18" r="2" fill="#F4F0E2"/><circle cx="15" cy="23" r="2" fill="#F4F0E2"/><path d="M-14 46C-18 54-16 60-14 64M14 46C18 54 16 60 14 64" fill="none" stroke="${hair}" stroke-width="5" stroke-linecap="round"/>`,
  }[rank];
  const mouth = rank === "J" ? `<path d="M-5 63Q0 66 5 63" fill="none" stroke="#8A3A2A" stroke-width="1.4" stroke-linecap="round"/><path d="M-6 60Q-3 58.4 0 60 3 58.4 6 60" fill="none" stroke="${beard}" stroke-width="1.6" stroke-linecap="round"/>`
    : `<path d="M-13 58C-15 82 15 82 13 58 9 70-9 70-13 58Z" fill="${beard}" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/><path d="M-7 61Q0 65 7 61" fill="none" stroke="#8A3A2A" stroke-width="1.4" stroke-linecap="round"/><path d="M-7 59Q-3 56.6 0 58.6 3 56.6 7 59" fill="none" stroke="${INK}" stroke-width="1.2" opacity=".7"/>`;
  const collar = rank === "K"
    ? `<path d="M-19 76Q0 94 19 76L24 84Q0 104-24 84Z" fill="#F4F0E2" stroke="${INK}" stroke-width="1"/><g fill="${INK}"><circle cx="-14" cy="84" r="1.2"/><circle cx="-7" cy="88" r="1.2"/><circle cx="0" cy="90" r="1.2"/><circle cx="7" cy="88" r="1.2"/><circle cx="14" cy="84" r="1.2"/></g>`
    : `<path d="M-12 74 0 91 12 74Z" fill="${o.trim}" stroke="${INK}" stroke-width="1"/>`;
  return `<g transform="translate(58 0)"><path d="M-35 108C-35 84-21 75 0 75S35 84 35 108Z" fill="${o.tunic}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M-34 100C-20 104 20 104 34 100" fill="none" stroke="${o.trim}" stroke-width="4"/>${collar}<rect x="-5.5" y="66" width="11" height="11" fill="${SKIN}" stroke="${INK}" stroke-width="1"/>
    <ellipse cy="55" rx="13.5" ry="15.5" fill="${SKIN}" stroke="${INK}" stroke-width="1.3"/>${mouth}
    <circle cx="-5.2" cy="52" r="1.5" fill="${INK}"/><circle cx="5.2" cy="52" r="1.5" fill="${INK}"/><path d="M-9.5 47.5Q-5.5 45.2-2 47M2 47Q5.5 45.2 9.5 47.5" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/><path d="M0 52 -1.8 58.4H1.2" fill="none" stroke="#B88A62" stroke-width="1.1"/>${hat}</g>
    ${emblem(kind, 58, 117, 0.48)}`;
}

/** A card's face as an SVG of 100 by 140 units: `pack` is "swiss" or "german", `rank` one of 6 7 8 9 T J Q K A, `suit` 0 to 3. */
export function cardArt(pack, rank, suit, letter) {
  const kind = KIND[pack][suit], o = LOOKS[kind];
  let field;
  if (PIPS[rank === "T" && pack === "german" ? 10 : rank]) field = PIPS[rank === "T" ? 10 : rank].map(([x, y]) => emblem(kind, x, y, { 6: 0.78, 7: 0.64, 8: 0.62, 9: 0.6, T: 0.56 }[rank])).join("");
  else if (rank === "T") field = `<path d="M36 18V124" stroke="#5A3A12" stroke-width="3" stroke-linecap="round"/><path d="M36 22H88L77 42 88 62H36Z" fill="${o.tunic}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/><text x="60" y="52" text-anchor="middle" font-size="25" font-weight="800" fill="#FFF8E4" font-family="inherit">10</text>${emblem(kind, 62, 96, 1.25)}`;
  else if (rank === "A") field = `<circle cx="58" cy="70" r="33" fill="none" stroke="${EDGE}" stroke-width="1.2" opacity=".6"/><circle cx="58" cy="70" r="29" fill="${o.tint}" stroke="${EDGE}" stroke-width=".8" opacity=".9"/>${emblem(kind, 58, 70, 1.5)}`;
  else field = figure(rank, o, kind);
  return `<svg class="tr-art" viewBox="0 0 100 140" aria-hidden="true"><rect x="21" y="7" width="75" height="126" rx="5" fill="${o.tint}" stroke="${EDGE}" stroke-width="1.2"/><rect x="24" y="10" width="69" height="120" rx="3" fill="none" stroke="${EDGE}" stroke-width=".6" opacity=".6"/>${field}
    <text x="11" y="21" text-anchor="middle" font-size="${letter.length > 1 ? 15 : 18}" font-weight="800" fill="${o.ink}" font-family="inherit">${letter}</text>${emblem(kind, 11, 35, 0.34)}</svg>`;
}
