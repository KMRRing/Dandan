// The gate's rule (lab/gate-sum.mjs, 11 Nov 2026), shared with lab/zero/loop.mjs (17 Nov): a challenger against the champion,
// looks at 300, 600 and 1,200 pairs, the 99% range. Pure: no store, no output.
export const Z99 = 2.576, pc = x => (100 * x).toFixed(1);
export const stats = xs => {
  const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, half: Z99 * sd / Math.sqrt(Math.max(1, n)) };
};
/**
 * The gate's word at the furthest look whose pairs are all in. A look reads pairs 0 to L-1 and waits for every one of them:
 * the pairs that finish first are the short games, and a look at "the first 300 to finish" would favour whoever wins quickly.
 */
export function gate(byPair) {
  let word = "", at = 0;
  for (const L of [300, 600, 1200]) {
    const xs = [];
    for (let p = 0; p < L && byPair.has(p); p++) xs.push(byPair.get(p));
    if (xs.length < L) break;
    const { mean, half } = stats(xs);
    at = L;
    word = L === 300 ? (mean + half < 0.5 ? "DROP" : "play on") : mean - half > 0.5 ? "CROWN" : L === 1200 || mean < 0.515 ? "DROP" : "EXTEND";
    if (word === "DROP" || word === "CROWN") break;
  }
  return at ? `${word} at the ${at}-pair look` : "running (the first look is at pairs 0 to 299, all in)";
}

