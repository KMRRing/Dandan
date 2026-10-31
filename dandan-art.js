// Dandan's card art, for the 3D view: a small picture for each of the twenty-five cards and the Clue, our own drawings
// in the suite's ink-and-brass manner (nothing taken from the printed cards, whose art belongs to its painters), and
// the back every hidden card shows. Each is a <symbol> in one sprite, put in the page once, so a card on the table is
// a <use> of it rather than its own copy of the drawing. A picture is drawn to 60 × 44 with what matters in its middle
// 40, since a card on the table crops it nearer square.
// (This page's Dandân is its own, redrawn on 31 October 2026 at Korbi's asking: a heavy-jawed predator out of the dark,
// teeth bared and an amber eye lit, light falling through the water; the rest are the Almanac's.)
const K = "#1C2A34";                                       // the ink every outline is drawn in

const ART = {
  "Island": `<rect width="60" height="44" fill="#CFE3EA"/><circle cx="45" cy="11" r="5" fill="#E2B865"/><path d="M0 26H60V44H0Z" fill="#1F6E8C"/>
    <path d="M12 27C16 19 22 15 29 15C37 15 42 20 48 27Z" fill="#7FA36B" stroke="${K}" stroke-width="1"/><path d="M21 20Q26 16.5 31 17.2" fill="none" stroke="#4F7A4A" stroke-width="1.1" stroke-linecap="round"/>
    <path d="M9 27.4H51" stroke="#E6CF98" stroke-width="2.2" stroke-linecap="round"/><path d="M5 33q3-1.6 6 0t6 0M33 37q3-1.6 6 0t6 0M41 31q2.5-1.4 5 0M14 39q3-1.6 6 0" fill="none" stroke="#EAF4F4" stroke-width="1" stroke-linecap="round"/>`,
  "Flood Plain": `<rect width="60" height="44" fill="#E6F0F0"/><path d="M0 17H60V44H0Z" fill="#A9C690"/><path d="M0 17H60" stroke="${K}" stroke-width=".7" opacity=".5"/>
    <path d="M0 22Q14 19.5 23 23.5T44 25.5T60 23V29.5Q46 31.5 36 29.5T14 29.5T0 27.5Z" fill="#3F7FB5"/><path d="M0 35Q12 33 21 36T42 38T60 36.5V44H0Z" fill="#3F7FB5" opacity=".85"/>
    <path d="M9 17V11.5M11.2 17V10.5M13.4 17V12.5M46 17V11M48.2 17V12.2M50.4 17V10.8" stroke="#4F7A4A" stroke-width="1" stroke-linecap="round"/>
    <path d="M6 25.2q3-1 6 0M27 27.4q3-1 6 0M46 26.4q3-1 6 0M18 38.4q3-1 6 0" fill="none" stroke="#EAF4F4" stroke-width=".9" stroke-linecap="round"/>
    <path d="M30 31.5V35.5M33 31.5V35.5" stroke="#8A6A44" stroke-width="1.2" stroke-linecap="round"/>`,
  "Halimar Depths": `<rect width="60" height="44" fill="#174E66"/><path d="M19 0L11 44H23L27 0Z" fill="#4F8FC5" opacity=".35"/><path d="M35 0L33 44H41L38.5 0Z" fill="#4F8FC5" opacity=".25"/>
    <path d="M0 39Q15 35 30 39T60 39V44H0Z" fill="#0F3A4E"/>
    <path d="M21 41V29Q30 20 39 29V41H34.5V30.5Q30 26.5 25.5 30.5V41Z" fill="#9AA3A0" stroke="${K}" stroke-width="1" stroke-linejoin="round"/><path d="M24 33H26M34 33H36" stroke="${K}" stroke-width=".6"/>
    <g fill="none" stroke="#CFE3EA" stroke-width=".8"><circle cx="45" cy="21" r="1.7"/><circle cx="47.5" cy="14.5" r="1.2"/><circle cx="45.5" cy="8.5" r=".8"/><circle cx="14" cy="16" r="1"/></g>`,
  "Izzet Boilerworks": `<rect width="60" height="44" fill="#E8D9C4"/><path d="M0 36H60V44H0Z" fill="#6B5B4B"/>
    <rect x="16" y="18" width="28" height="18" fill="#9A5A42" stroke="${K}" stroke-width="1"/><path d="M14 18.5L30 10L46 18.5Z" fill="#5C4033" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>
    <rect x="20" y="5" width="4.4" height="10" fill="#5C4033" stroke="${K}" stroke-width="1"/><rect x="36.6" y="8" width="4.4" height="7" fill="#5C4033" stroke="${K}" stroke-width="1"/>
    <rect x="21" y="23" width="5" height="7" fill="#E8603C" stroke="${K}" stroke-width=".7"/><rect x="34" y="23" width="5" height="7" fill="#E8603C" stroke="${K}" stroke-width=".7"/><rect x="27.6" y="27" width="4.8" height="9" fill="#3B2A22"/>
    <g fill="#EAF4F4" stroke="#3F7FB5" stroke-width=".8"><circle cx="21.5" cy="3" r="2.6"/><circle cx="26" cy="1.6" r="2"/><circle cx="39.5" cy="5" r="2.3"/><circle cx="43.6" cy="3.4" r="1.6"/></g>
    <path d="M8 30l1.6-3 1 2.2 1.6-3" fill="none" stroke="#E8603C" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`,
  "Lonely Sandbar": `<rect width="60" height="44" fill="#E6F0F0"/><circle cx="15" cy="11" r="4" fill="#E2B865" opacity=".85"/><path d="M0 22H60V44H0Z" fill="#3F7FB5"/>
    <path d="M3 31Q19 25.5 35 27.5T58 33Q40 33.5 24 34.5T3 31Z" fill="#E6CF98" stroke="${K}" stroke-width=".9" stroke-linejoin="round"/>
    <path d="M37 12q2-2.2 4 0q2-2.2 4 0" fill="none" stroke="${K}" stroke-width="1" stroke-linecap="round"/>
    <path d="M7 38q3-1.4 6 0t6 0M38 40q3-1.4 6 0M44 25q2.5-1.2 5 0" fill="none" stroke="#EAF4F4" stroke-width=".9" stroke-linecap="round"/>`,
  "Mystic Sanctuary": `<rect width="60" height="44" fill="#2C4A63"/><g fill="#FBF4E4"><circle cx="9" cy="7" r=".7"/><circle cx="50" cy="5" r=".6"/><circle cx="54" cy="14" r=".7"/><circle cx="6" cy="18" r=".5"/></g>
    <ellipse cx="30" cy="21" rx="15" ry="10" fill="#E2B865" opacity=".16"/><path d="M0 34H60V44H0Z" fill="#1F6E8C"/>
    <path d="M17 34.5L21.5 26H38.5L43 34.5Z" fill="#6E7F86" stroke="${K}" stroke-width="1" stroke-linejoin="round"/><rect x="23" y="17" width="14" height="9" fill="#EFE6D2" stroke="${K}" stroke-width="1"/>
    <path d="M22 17.2Q30 6.5 38 17.2Z" fill="#C8923A" stroke="${K}" stroke-width="1" stroke-linejoin="round"/><path d="M30 7.6V4" stroke="#C8923A" stroke-width="1.1" stroke-linecap="round"/>
    <path d="M28 26V21.4Q30 18.6 32 21.4V26Z" fill="#E2B865"/><path d="M6 38q3-1.4 6 0t6 0M38 39q3-1.4 6 0t6 0" fill="none" stroke="#EAF4F4" stroke-width=".9" stroke-linecap="round"/>`,
  "Remote Isle": `<rect width="60" height="44" fill="#D9E6E8"/><path d="M0 25H60V44H0Z" fill="#5E8FAE"/>
    <path d="M33 25.5Q38 16 43 12.5Q48 16.5 54 25.5Z" fill="#8AA39A" stroke="${K}" stroke-width=".8" stroke-linejoin="round"/><path d="M40.5 15.5L43 12.5L45.4 15.8" fill="none" stroke="#FBF4E4" stroke-width=".9"/>
    <path d="M0 17.5H60M5 21H55" stroke="#FBF4E4" stroke-width="1.7" opacity=".7"/>
    <path d="M14 31.5H22L20.6 33.6H15.4Z" fill="#8A6A44" stroke="${K}" stroke-width=".6"/><path d="M18 31.5V26L21.4 31Z" fill="#FBF4E4" stroke="${K}" stroke-width=".6" stroke-linejoin="round"/>
    <path d="M8 37q3-1.4 6 0t6 0M32 39q3-1.4 6 0t6 0" fill="none" stroke="#EAF4F4" stroke-width=".9" stroke-linecap="round"/>`,
  "Thundering Falls": `<rect width="60" height="44" fill="#3A4A58"/><path d="M0 0H23V44H0Z" fill="#6E6A5E"/><path d="M37 0H60V44H37Z" fill="#6E6A5E"/>
    <path d="M23 7H37V44H23Z" fill="#3F7FB5"/><path d="M26 8V40M29.5 8V42M33 8V40M35.6 8V37" stroke="#CFE3EA" stroke-width=".9" opacity=".85"/>
    <path d="M23 0V7H37V0" fill="none" stroke="${K}" stroke-width="1"/><path d="M23 7V44M37 7V44" stroke="${K}" stroke-width="1"/>
    <path d="M17 40.5Q30 33.5 43 40.5V44H17Z" fill="#EAF4F4" opacity=".9"/>
    <path d="M47 2L41.5 13.5H46L39.5 25L51 10.5H46.4L50 2Z" fill="#E8603C" stroke="${K}" stroke-width=".8" stroke-linejoin="round"/>
    <path d="M4 12L9 10M3 22L8 21M50 30L56 28" stroke="#58554B" stroke-width="1" stroke-linecap="round"/>`,
  "Dandân": `<defs>
    <linearGradient id="dn-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3F93B3"/><stop offset=".38" stop-color="#16556F"/><stop offset="1" stop-color="#06202E"/></linearGradient>
    <radialGradient id="dn-glow" cx=".3" cy=".5" r=".55"><stop offset="0" stop-color="#8FD3E3" stop-opacity=".5"/><stop offset="1" stop-color="#8FD3E3" stop-opacity="0"/></radialGradient>
    <radialGradient id="dn-vig" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#03121C" stop-opacity="0"/><stop offset="1" stop-color="#03121C" stop-opacity=".6"/></radialGradient>
    <linearGradient id="dn-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A2F4E"/><stop offset=".36" stop-color="#1D78AA"/><stop offset=".72" stop-color="#9AD0DF"/><stop offset="1" stop-color="#F0F6EC"/></linearGradient>
    <linearGradient id="dn-fin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E92C2"/><stop offset="1" stop-color="#0F4468"/></linearGradient>
    <radialGradient id="dn-eye" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFE9A8" stop-opacity=".9"/><stop offset="1" stop-color="#E2B865" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="60" height="44" fill="url(#dn-sea)"/>
    <rect width="60" height="44" fill="url(#dn-glow)"/>
    <path d="M8 0H17L28 44H8Z" fill="#E6F4F4" opacity=".13"/><path d="M26 0H31L48 44H34Z" fill="#E6F4F4" opacity=".1"/><path d="M43 0H46L60 28V44Z" fill="#E6F4F4" opacity=".07"/>
    <path d="M0 3q3-1.5 6 0t6 0t6 0t6 0t6 0t6 0t6 0t6 0t6 0t6 0" fill="none" stroke="#EAF4F4" stroke-width=".9" stroke-linecap="round" opacity=".5"/>
    <path d="M0 40Q2 33 1 27Q5 33 5.5 44Z M8 44Q9 38 8 33Q12 38 12.5 44Z" fill="#06202A" opacity=".75"/><path d="M54 44Q56 36 54.5 29Q59 35 60 44Z" fill="#06202A" opacity=".75"/>
    <g transform="rotate(-8 28 22)">
    <path d="M43.4 21.4Q47.4 16.6 53 9.6Q51 16.8 52.4 22.6Q50.8 28.4 53.6 36Q47.6 32.4 43.6 26.4Z" fill="url(#dn-fin)" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M47.4 21.6L51.2 12.6M47.6 24L51.4 32.4" stroke="#E2B865" stroke-width=".6" stroke-linecap="round"/>
    <path d="M23.4 15.8L25.4 6.6L28.8 12.6L32.2 4.2L35 11.6L39 6.6L39.6 15.6L43 12L44 20Q34 14.4 23.4 15.8Z" fill="url(#dn-fin)" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M25.4 8.2L26.8 14M32.2 6L33.2 13M39 8.4L39.2 14.6" stroke="#E2B865" stroke-width=".7" stroke-linecap="round"/>
    <path d="M26.4 34L34.6 35.6L37.8 41.8Q30.8 39.6 26.4 34Z" fill="url(#dn-fin)" stroke="${K}" stroke-width=".9" stroke-linejoin="round"/><path d="M31.4 36.4L34.6 39.4M29 36L31.2 38.2" stroke="#E2B865" stroke-width=".5" stroke-linecap="round"/>
    <path d="M8.5 23.4L23.8 27.6L11.6 32.4Z" fill="#2A0B10"/><path d="M13 28.6L22.2 27.8L14.8 31.2Z" fill="#A8382B"/>
    <path d="M8.5 23.4Q11.5 18.6 19.6 15.6Q28.5 12.2 37.4 15.4Q41.4 17.2 44.4 21.4V25.4Q39 33 31 36.4Q26 38.8 19.6 36Q15 34.8 11.6 32.4L22.8 27.4Z" fill="url(#dn-body)" stroke="${K}" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M8.87 23.5L9.56 26.87L10.99 24.1ZM11.73 24.3L12.45 27.42L13.85 24.9ZM14.59 25.1L15.34 27.96L16.71 25.7ZM17.45 25.9L18.23 28.5L19.57 26.5ZM20.31 26.7L21.12 29.05L22.43 27.3Z" fill="#FBF4E4" stroke="${K}" stroke-width=".45" stroke-linejoin="round"/><path d="M12.93 31.81L14.11 28.73L14.75 30.99ZM15.24 30.77L16.4 27.94L17.07 29.96ZM17.56 29.74L18.69 27.14L19.38 28.93ZM19.87 28.71L20.98 26.35L21.7 27.89Z" fill="#FBF4E4" stroke="${K}" stroke-width=".45" stroke-linejoin="round"/>
    <g fill="none" stroke="#7CC4DE" stroke-width=".7" stroke-linecap="round" opacity=".85"><path d="M29.6 18.8q1.7 1.6 0 3.4M33.4 18.4q1.7 1.7 0 3.6M37.2 19q1.6 1.6 0 3.4M31.6 26.4q1.7 1.6 0 3.2M35.4 25.8q1.7 1.6 0 3.2M39 24.8q1.5 1.5 0 3"/></g>
    <path d="M15 19.2Q26 13.8 38 16.8" fill="none" stroke="#9ED8E8" stroke-width=".8" stroke-linecap="round" opacity=".55"/><path d="M28 24.4Q35 22.6 44 23.8" fill="none" stroke="#E2B865" stroke-width="1" stroke-linecap="round"/>
    <g fill="#E2B865"><circle cx="29" cy="32.2" r=".4"/><circle cx="31.6" cy="33.2" r=".4"/><circle cx="34.2" cy="33.4" r=".4"/><circle cx="36.8" cy="32.6" r=".4"/><circle cx="39.2" cy="31.2" r=".4"/></g>
    <path d="M24.6 18.2Q22.8 24.6 24.8 31M26.8 19Q25 24.6 27 30.4" fill="none" stroke="#A8382B" stroke-width="1.1" stroke-linecap="round"/>
    <circle cx="17.8" cy="20.2" r="5.6" fill="url(#dn-eye)"/><circle cx="17.8" cy="20.2" r="2.9" fill="#E2B865" stroke="${K}" stroke-width=".9"/><ellipse cx="17.4" cy="20.2" rx=".75" ry="2.1" fill="${K}"/><circle cx="18.6" cy="19.2" r=".6" fill="#FBF4E4"/>
    <path d="M13 19.2Q17.6 14.8 23 18.4" fill="none" stroke="${K}" stroke-width="1.6" stroke-linecap="round"/>
    </g>
    <rect width="60" height="44" fill="url(#dn-vig)"/>
    <g fill="none" stroke="#EAF4F4" stroke-width=".5" opacity=".7"><circle cx="12" cy="11" r="1.3"/><circle cx="14.6" cy="7" r=".9"/><circle cx="10.6" cy="5.4" r=".6"/><circle cx="50" cy="38" r="1"/><circle cx="52.4" cy="33" r=".6"/></g>`,
  "Brainstorm": `<rect width="60" height="44" fill="#2C4A63"/><g fill="#FBF4E4"><circle cx="8" cy="9" r=".7"/><circle cx="53" cy="22" r=".6"/><circle cx="6" cy="30" r=".5"/></g>
    <path d="M19 44V34.5Q11.5 32 12.5 24Q13 14.5 24 13.5Q33 13 35 21L38.2 26.4Q38.4 28.2 36.4 28.4V33Q35.4 36.2 31 35.4V44Z" fill="#FBF4E4" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M27 3.6Q31 -1 37 2.6Q43 -.2 46 4.8Q52 5 51 10.4Q53 15.6 46.6 15.6H28.6Q22.4 15.6 23.4 10.4Q22.4 5.6 27 3.6Z" fill="#9DB8C4" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M39.5 15.4L36.4 21.4H39.4L36.6 27.4" fill="none" stroke="#6FB7D2" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="31" cy="22.6" r="1.1" fill="${K}"/>`,
  "Commit // Memory": `<rect width="60" height="44" fill="#E9DCC0"/><path d="M36 0H60V44H22Z" fill="#2C4A63"/><path d="M36 0L22 44" stroke="#C8923A" stroke-width="1.2"/>
    <g stroke="${K}" stroke-width=".9" stroke-linejoin="round"><rect x="5" y="23" width="12" height="16" rx="1.4" fill="#FBF4E4"/><rect x="7" y="21" width="12" height="16" rx="1.4" fill="#FBF4E4"/><rect x="9" y="19" width="12" height="16" rx="1.4" fill="#F3E6C8"/></g>
    <path d="M3 11H17M17 11L13.6 7.8M17 11L13.6 14.2" fill="none" stroke="#A8382B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M44 22.5a1.2 1.2 0 1 1 2.4 0a3.4 3.4 0 1 1 -6.8 0a5.6 5.6 0 1 1 11.2 0a7.8 7.8 0 1 1 -15.6 0" fill="none" stroke="#6FB7D2" stroke-width="1.3" stroke-linecap="round"/>`,
  "Memory Lapse": `<rect width="60" height="44" fill="#DCE6E4"/><path d="M20.5 6H39.5M20.5 38H39.5" stroke="#C8923A" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M23 7.2Q23 17 30 22Q23 27 23 36.8H37Q37 27 30 22Q37 17 37 7.2Z" fill="#FBF4E4" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M25.6 9.4Q26.2 15 30 18.8Q33.8 15 34.4 9.4Z" fill="#E6CF98"/><path d="M30 22V35" stroke="#C8A86A" stroke-width=".8" stroke-dasharray="1 1.4"/>
    <path d="M44.5 27Q51 20 46.5 12.5M46.5 12.5L43.7 15.4M46.5 12.5L49.2 15.2" fill="none" stroke="#3F7FB5" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M9 14q4-3 8 0M7.5 20q5-3 10 0M10 26q3.4-2 6.8 0" fill="none" stroke="#9DB8C4" stroke-width="1" stroke-linecap="round"/>`,
  "Metamorphose": `<rect width="60" height="44" fill="#E3ECDF"/><path d="M6 4.5H25" stroke="#6B5B4B" stroke-width="1.6" stroke-linecap="round"/><path d="M15 4.5V11" stroke="#6B5B4B" stroke-width=".9"/>
    <path d="M15 11Q10.5 18 12.5 26.5Q15 31 17.5 26.5Q19.5 18 15 11Z" fill="#9DBE8A" stroke="${K}" stroke-width="1" stroke-linejoin="round"/><path d="M13 17q2 1 4 0M12.8 21.5q2.2 1 4.4 0" fill="none" stroke="#5E8A55" stroke-width=".7"/>
    <path d="M21 32q5-7 13-8" fill="none" stroke="#C8923A" stroke-width="1" stroke-dasharray="1.2 1.6" stroke-linecap="round"/>
    <g stroke="${K}" stroke-width="1" stroke-linejoin="round"><path d="M41 22Q33 9.5 28.5 15.5Q28 24 41 23Z" fill="#3F7FB5"/><path d="M41 22Q49 9.5 53.5 15.5Q54 24 41 23Z" fill="#3F7FB5"/>
    <path d="M41 23Q34 32.5 31.8 28.4Q31.6 25 41 23Z" fill="#6FB7D2"/><path d="M41 23Q48 32.5 50.2 28.4Q50.4 25 41 23Z" fill="#6FB7D2"/></g>
    <path d="M41 16V30" stroke="${K}" stroke-width="1.5" stroke-linecap="round"/><path d="M41 16Q39 12 37 11M41 16Q43 12 45 11" fill="none" stroke="${K}" stroke-width=".8" stroke-linecap="round"/>
    <circle cx="35" cy="16" r="1.2" fill="#E2B865"/><circle cx="47" cy="16" r="1.2" fill="#E2B865"/>`,
  "Mind Bend": `<rect width="60" height="44" fill="#EFE3C6"/><circle cx="15" cy="25" r="9.5" fill="#3F7FB5" stroke="${K}" stroke-width="1"/>
    <path d="M8.6 26q2.1-2 4.2 0t4.2 0 4.2 0M9.6 22q1.8-1.6 3.6 0t3.6 0 3.6 0" fill="none" stroke="#FBF4E4" stroke-width="1.2" stroke-linecap="round"/>
    <circle cx="45" cy="25" r="9.5" fill="#B84A32" stroke="${K}" stroke-width="1"/><path d="M38.4 29.4L42.6 20.6L45.4 25.6L47.4 22.6L51.6 29.4Z" fill="#FBF4E4" stroke="${K}" stroke-width=".6" stroke-linejoin="round"/>
    <path d="M21 13Q30 4 39 13" fill="none" stroke="${K}" stroke-width="1.3" stroke-linecap="round"/><path d="M39 13L35.2 12.4M39 13L38.4 9.2" fill="none" stroke="${K}" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M22 37Q30 42 38 37" fill="none" stroke="#C8923A" stroke-width="1" stroke-dasharray="1.6 1.6" stroke-linecap="round"/>`,
  "Narset's Reversal": `<rect width="60" height="44" fill="#E4E9E6"/><ellipse cx="35" cy="19.5" rx="10" ry="13" fill="#CFE3EA" stroke="#C8923A" stroke-width="2.4"/><ellipse cx="35" cy="19.5" rx="11.4" ry="14.4" fill="none" stroke="${K}" stroke-width=".7"/>
    <path d="M35 34V42.5" stroke="#C8923A" stroke-width="3.2" stroke-linecap="round"/><path d="M30 12.5Q32 10.4 34.4 11" fill="none" stroke="#FBF4E4" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M3 14H22M22 14L18.4 10.6M22 14L18.4 17.4" fill="none" stroke="#A8382B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M22 26H3M3 26L6.6 22.6M3 26L6.6 29.4" fill="none" stroke="#1F6E8C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  "Piracy Charm": `<rect width="60" height="44" fill="#1F4A5E"/><circle cx="30" cy="5" r="2.3" fill="none" stroke="#C8923A" stroke-width="1.1"/><path d="M30 7.3V9" stroke="#C8923A" stroke-width="1.1"/>
    <circle cx="30" cy="23" r="14" fill="#E2B865" stroke="${K}" stroke-width="1.2"/><circle cx="30" cy="23" r="11" fill="none" stroke="#C8923A" stroke-width="1"/>
    <path d="M22.5 15.5L37.5 30.5M37.5 15.5L22.5 30.5" stroke="#FBF4E4" stroke-width="2.2" stroke-linecap="round"/><path d="M22.5 15.5L37.5 30.5M37.5 15.5L22.5 30.5" stroke="${K}" stroke-width=".6" stroke-linecap="round"/>
    <path d="M20.6 28.4L24.6 32.4M39.4 28.4L35.4 32.4" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/><circle cx="30" cy="23" r="2" fill="#A8382B" stroke="${K}" stroke-width=".7"/>`,
  "Predict": `<rect width="60" height="44" fill="#2B2F4A"/><g fill="#FBF4E4"><circle cx="8" cy="8" r=".7"/><circle cx="52" cy="10" r=".6"/><circle cx="49" cy="30" r=".5"/><circle cx="10" cy="28" r=".5"/></g>
    <path d="M21.5 39L24.6 33.4H35.4L38.5 39Z" fill="#9A6A3C" stroke="${K}" stroke-width="1" stroke-linejoin="round"/><ellipse cx="30" cy="39.4" rx="12" ry="2.6" fill="#C8923A" stroke="${K}" stroke-width="1"/>
    <circle cx="30" cy="20" r="13" fill="#6FA3D4" fill-opacity=".55" stroke="#CFE3EA" stroke-width="1.2"/>
    <path d="M21.6 20Q30 12.6 38.4 20Q30 27.4 21.6 20Z" fill="#FBF4E4" stroke="${K}" stroke-width=".9"/><circle cx="30" cy="20" r="3" fill="#1F6E8C"/><circle cx="30" cy="20" r="1.3" fill="${K}"/>
    <path d="M23 11.5Q26 9.2 29 9.2" fill="none" stroke="#FBF4E4" stroke-width="1.2" stroke-linecap="round"/>`,
  "Quicken": `<rect width="60" height="44" fill="#E6F0F0"/><path d="M2 15H17M4 21.5H19M2 28H15" stroke="#9DB8C4" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M19 24Q31 11.5 50 11.5Q43 17 41 19.6Q49 21.4 55.5 30.5Q43 28 34.5 26.4Q27.5 30.6 19 24Z" fill="#2C4A63" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M23.5 23.4Q29.5 22 34.5 26.4" fill="none" stroke="#FBF4E4" stroke-width="1" stroke-linecap="round"/><circle cx="46.2" cy="14.2" r=".9" fill="#FBF4E4"/>
    <circle cx="11" cy="36" r="4.4" fill="#E2B865" stroke="${K}" stroke-width=".8"/><path d="M11 33.4V36L12.8 37.2" fill="none" stroke="${K}" stroke-width=".8" stroke-linecap="round"/>`,
  "Repulse": `<rect width="60" height="44" fill="#DCE8EC"/><path d="M5 18L11 22L5 26" fill="none" stroke="${K}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M14 8Q22.5 22 14 36" fill="none" stroke="#3F7FB5" stroke-width="2.2" stroke-linecap="round"/><path d="M20.5 4Q31 22 20.5 40" fill="none" stroke="#3F7FB5" stroke-width="1.7" stroke-linecap="round" opacity=".7"/>
    <path d="M27 2Q39.5 22 27 42" fill="none" stroke="#3F7FB5" stroke-width="1.2" stroke-linecap="round" opacity=".45"/>
    <g transform="rotate(14 48 22)"><path d="M39 22Q45 15 52 20L57 16.5V27.5L52 24Q45 29 39 22Z" fill="#1F6E8C" stroke="${K}" stroke-width=".9" stroke-linejoin="round"/><circle cx="43" cy="21" r="1" fill="#FBF4E4"/></g>
    <path d="M44 34l3 1.5M47 30.5l3.4.6" stroke="#9DB8C4" stroke-width="1" stroke-linecap="round"/>`,
  "Chart a Course": `<rect width="60" height="44" fill="#EFE3C6"/><path d="M35 44Q39 34.5 49 32Q56 30 60 24V44Z" fill="#B9CFA0" stroke="${K}" stroke-width=".8"/>
    <path d="M9 34Q17 22 27 26T44 14" fill="none" stroke="#A8382B" stroke-width="1.2" stroke-dasharray="2 1.6" stroke-linecap="round"/><path d="M42.2 10.2L46.2 14.2M46.2 10.2L42.2 14.2" stroke="#A8382B" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="16" cy="14" r="6.4" fill="none" stroke="${K}" stroke-width=".6"/><path d="M16 5.6L18 14L16 22.4L14 14Z" fill="${K}"/><path d="M7.6 14L16 12L24.4 14L16 16Z" fill="#C8923A" stroke="${K}" stroke-width=".4"/>
    <path d="M5 34.4H11.4L10.2 36.6H6.2Z" fill="#8A6A44" stroke="${K}" stroke-width=".6"/><path d="M8.2 34.4V29L11.2 33.8Z" fill="#FBF4E4" stroke="${K}" stroke-width=".6" stroke-linejoin="round"/>
    <path d="M1 1H59V43H1Z" fill="none" stroke="#C8923A" stroke-width="1.4"/>`,
  "Deem Inferior": `<rect width="60" height="44" fill="#E9E1CF"/><path d="M30 7V36.5" stroke="#C8923A" stroke-width="2"/><path d="M21.5 38H38.5" stroke="#C8923A" stroke-width="3" stroke-linecap="round"/>
    <path d="M14 10.5L46 18.5" stroke="#C8923A" stroke-width="1.9" stroke-linecap="round"/><circle cx="30" cy="6.4" r="2" fill="#E2B865" stroke="${K}" stroke-width=".8"/>
    <path d="M14 10.5L9 21.5M14 10.5L19 21.5M46 18.5L41 29.5M46 18.5L51 29.5" stroke="${K}" stroke-width=".7"/>
    <path d="M8 21.5H20Q19 25.6 14 25.6Q9 25.6 8 21.5Z" fill="#E2B865" stroke="${K}" stroke-width=".9"/><path d="M40 29.5H52Q51 33.6 46 33.6Q41 33.6 40 29.5Z" fill="#E2B865" stroke="${K}" stroke-width=".9"/>
    <rect x="42.6" y="24.6" width="6.8" height="4.9" fill="${K}"/><path d="M11 21q2-2.4 4.4-1.2L17 18.6V21.4L15.4 20.4Q13 22 11 21Z" fill="#1F6E8C"/>`,
  "Gone Missing": `<rect width="60" height="44" fill="#5C4A3E"/><path d="M0 38H60V44H0Z" fill="#46382F"/>
    <rect x="15" y="6" width="27" height="29" fill="#E9E1CF" stroke="#C8923A" stroke-width="2.6"/><rect x="13.6" y="4.6" width="29.8" height="31.8" fill="none" stroke="${K}" stroke-width=".7"/>
    <path d="M22 31Q22 23 28.5 23Q35 23 35 31M28.5 22.4a4.2 4.2 0 1 0 0-8.4a4.2 4.2 0 1 0 0 8.4" fill="none" stroke="#9A8F7E" stroke-width="1" stroke-dasharray="1.5 1.5"/>
    <path d="M47.5 13q0-4 4.2-4t4.2 4q0 3-4.2 4.2v3" fill="none" stroke="#E2B865" stroke-width="1.7" stroke-linecap="round"/><circle cx="51.7" cy="24.4" r="1.1" fill="#E2B865"/>`,
  "Lórien Revealed": `<rect width="60" height="44" fill="#F1E2B0"/><path d="M30 0L21 44H39Z" fill="#FFF7D6" opacity=".55"/><path d="M0 36H60V44H0Z" fill="#8A7A3A"/>
    <path d="M12 44V12M30 44V7M48 44V13" stroke="#B8A887" stroke-width="3"/><path d="M12 44V12M30 44V7M48 44V13" stroke="${K}" stroke-width=".5" opacity=".6"/>
    <g fill="#E2B865" stroke="${K}" stroke-width=".8"><ellipse cx="12" cy="11" rx="8" ry="6.4"/><ellipse cx="30" cy="7" rx="9" ry="6.4"/><ellipse cx="48" cy="12" rx="8" ry="6.4"/></g>
    <path d="M22 38.4Q30 34.6 30 38.6Q30 34.6 38 38.4V42.4Q30 38.6 30 42.6Q30 38.6 22 42.4Z" fill="#FBF4E4" stroke="${K}" stroke-width=".8" stroke-linejoin="round"/>`,
  "Mystic Retrieval": `<rect width="60" height="44" fill="#3A2F4A"/>
    <path d="M44 20.5a1.2 1.2 0 1 1 2.4 0a3.4 3.4 0 1 1 -6.8 0a5.6 5.6 0 1 1 11.2 0a7.8 7.8 0 1 1 -15.6 0" fill="none" stroke="#B87396" stroke-width="1.3" stroke-linecap="round"/>
    <rect x="17" y="15.5" width="17" height="10" rx="1" fill="#FBF4E4" stroke="${K}" stroke-width=".9"/><circle cx="17" cy="20.5" r="2.6" fill="#E9DCC0" stroke="${K}" stroke-width=".8"/><circle cx="34" cy="20.5" r="2.6" fill="#E9DCC0" stroke="${K}" stroke-width=".8"/>
    <path d="M21 19H30M21 22H28" stroke="#C8923A" stroke-width=".8"/><path d="M4 24.5H13Q16.6 24.5 16.6 21" fill="none" stroke="#E2B865" stroke-width="2" stroke-linecap="round"/>
    <path d="M45 36.5Q43 31 47 27Q47 31.5 50 32.5Q51 29.5 50 27.5Q54 31.5 52 36.5Q49 39.4 45 36.5Z" fill="#E8603C" stroke="${K}" stroke-width=".8" stroke-linejoin="round"/>`,
  "Take Inventory": `<rect width="60" height="44" fill="#E9DCC0"/><path d="M3 10.5H57M3 21H57" stroke="#9A6A3C" stroke-width="1.7"/>
    <g stroke="${K}" stroke-width=".7"><rect x="7" y="4" width="5" height="6.5" fill="#3F7FB5"/><rect x="14" y="5.5" width="4" height="5" fill="#C8923A"/><rect x="20" y="3.5" width="5" height="7" fill="#7FA36B"/><rect x="40" y="4.5" width="6" height="6" fill="#B84A32"/><rect x="48" y="3.5" width="4" height="7" fill="#3F7FB5"/>
    <rect x="9" y="15" width="6" height="6" fill="#E2B865"/><rect x="17" y="14" width="4" height="7" fill="#3F7FB5"/><rect x="38" y="15.5" width="5" height="5.5" fill="#7FA36B"/></g>
    <path d="M9 26.5H30V40.5H9Z" fill="#FBF4E4" stroke="${K}" stroke-width=".9"/><path d="M30 26.5H51V40.5H30Z" fill="#FBF4E4" stroke="${K}" stroke-width=".9"/>
    <path d="M13 30V36M15 30V36M17 30V36M19 30V36M11.8 35.2L20.2 30.8" stroke="${K}" stroke-width=".8" stroke-linecap="round"/><path d="M33 30.4H47M33 33.4H45M33 36.4H47" stroke="#C8923A" stroke-width=".8"/>
    <path d="M44 24Q52.4 13.4 56.4 15.4Q52.4 21.4 46 25.4Z" fill="#FBF4E4" stroke="${K}" stroke-width=".8" stroke-linejoin="round"/>`,
  "Clue": `<rect width="60" height="44" fill="#E4D9C0"/><g transform="rotate(-8 23 22)"><rect x="12" y="8" width="22" height="28" fill="#FBF4E4" stroke="${K}" stroke-width=".9"/><path d="M15.5 14H30.5M15.5 18H28.5M15.5 22H30.5M15.5 26H25" stroke="#C8923A" stroke-width=".8"/></g>
    <circle cx="36" cy="21" r="9" fill="#CFE3EA" fill-opacity=".55" stroke="#C8923A" stroke-width="2.4"/><circle cx="36" cy="21" r="10.3" fill="none" stroke="${K}" stroke-width=".6"/>
    <path d="M42.6 27.6L50.5 35.5" stroke="#6B4A2A" stroke-width="3.4" stroke-linecap="round"/><path d="M32 16.5Q34 15 36.4 15.2" fill="none" stroke="#FBF4E4" stroke-width="1.2" stroke-linecap="round"/>`,
};

/** The card back: navy, a brass frame and the fish in its medallion, drawn to 50 × 70. */
const BACK = `<rect width="50" height="70" rx="3" fill="#1C2A34"/><rect x="3" y="3" width="44" height="64" rx="2" fill="none" stroke="#C8923A" stroke-width="1.3"/>
  <rect x="6" y="6" width="38" height="58" rx="1.5" fill="none" stroke="#C8923A" stroke-width=".55" stroke-dasharray="1.5 1.5"/>
  <path d="M25 17V22M25 48V53M7.5 35H12.5M37.5 35H42.5" stroke="#C8923A" stroke-width="1" stroke-linecap="round"/>
  <circle cx="25" cy="35" r="11" fill="#1F6E8C" stroke="#C8923A" stroke-width="1.1"/>
  <path d="M16.6 35Q22 28 29 32L33.4 29V41L29 38Q22 42 16.6 35Z" fill="#E2B865" stroke="#1C2A34" stroke-width=".6" stroke-linejoin="round"/><circle cx="20.6" cy="34.4" r=".9" fill="#1C2A34"/>`;

const slug = name => name.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const OF = { Commit: "Commit // Memory", Memory: "Commit // Memory" };   // a half's picture is its card's

/** The sprite with every picture, for the page to hold once. */
export const SPRITE = `<svg class="d3-sprite" aria-hidden="true" focusable="false"><defs>${Object.entries(ART).map(([n, svg]) => `<symbol id="dda-${slug(n)}" viewBox="0 0 60 44">${svg}</symbol>`).join("")}<symbol id="dda-back" viewBox="0 0 50 70">${BACK}</symbol></defs></svg>`;

/** A card's picture (by card name, a half's by its card's), cropped to fill its box. */
export function art(name) {
  const n = OF[name] || name;
  return ART[n] ? `<svg class="d3-art" viewBox="0 0 60 44" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#dda-${slug(n)}" width="60" height="44"/></svg>` : "";
}
/** The back of a card. */
export const back = () => `<svg class="d3-back" viewBox="0 0 50 70" preserveAspectRatio="none" aria-hidden="true"><use href="#dda-back" width="50" height="70"/></svg>`;
/** The names that have a picture: every card in the deck, and the Clue. */
export const PICTURED = Object.keys(ART);
