// The games page's search through every log (games.js matches): the search as a phrase, any case; phrases joined with +
// must all be in the line. Korbi, 10 November 2026: find where Monte cast Mind Bend at a Halimar Depths, across all games.
globalThis.__GAMES_TEST = true;
const { matches } = await import("../games.js");
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exit(1); } };
const line = "Monte casts Mind Bend on You's Halimar Depths";
ok(matches(line, "Monte casts Mind Bend"), "a phrase as written");
ok(matches(line, "monte CASTS mind bend"), "any case");
ok(matches(line, "halimar + monte casts mind bend"), "phrases joined with +, in any order");
ok(!matches(line, "Monte casts Repulse"), "a phrase that isn't there");
ok(!matches("Dave casts Mind Bend on Monte's Dandân", "monte casts mind bend"), "the words in another order are another line");
ok(!matches(line, "monte casts mind bend + island"), "every phrase must be there");
console.log("games search: ok");
