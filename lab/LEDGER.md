# The lab's ledger

Every lab job run on Google Cloud since 10 November 2026, whether it led anywhere or not, so nothing is run twice by mistake.
Jobs live in the bucket `gs://dandan-lab-807207481983` (project `project-b753c78c-ef88-46f1-b37`): `jobs/<id>.json` is the
spec (with `purpose` and, once read, `outcome`), `results/<id>/` what each shard wrote. `node lab/ledger.mjs` on a lab machine
lists them all with their progress. Earlier runs (GitHub Actions, up to 9 November) are in README.md's Matches section.

The workers fill the queue themselves when it runs dry (`LAB_FILL=1`): the next self-play batch `spb<n>` (120 games, Hard 256
deals against itself, seeds 7000 + 120(n−1) on) and, for each finished batch, `jt<n>`, the judge trained on batches 1..n.

| job | what | settings | result |
|---|---|---|---|
| trial1 | worker trial | bench, 4 shards | worked: Spot c2d-highcpu-4 up in a minute, results in the bucket |
| tune1 | constant search, 87 candidates ±0.5 | 512 pairs each, vs `medium-fit-2` | void: the reference was an old build (base scored 0.461), every z inflated |
| tune2 | constant search, 87 candidates ±0.5 | 512 new pairs, vs main | nothing: best Mystic Retrieval +0.5 at 0.5195 ± 0.009 (z 2.2), 2 of 86 over z 2 = chance; round-1 leaders gone. TUNE/ADJ sit at a local optimum at this step |
| head1 | headroom: Hard 256 vs Medium | 240 pairs | Hard 86.9% ± 1.5 (82% up to 20 turns, 91% 21–30, 87% over 30); 8 of 480 ended by the library |
| jc1 | the judge against 64 Medium playouts to the end, by library size | 480 games planned, stopped at 80 (4× slower than estimated) | judge off by 12 points (rmse) at 21–80 cards, 22 at 13–20, worse below; below 20 it predicts the winner half as well as playouts. 2,000 positions |
| late1 | late-game match: main vs `race20` (Hard plays to the end from 20 cards, not 8) | Hard 64, games start at 24 cards, 1,600 deals | rejected: race20 48.6% ± 0.7 over 626 pairs (46 of 48 shards). 541 of 626 pairs split 1–1: from 24 cards the position mostly decides the game, only 85 pairs told the builds apart |
| spb01… | self-play batches | Hard 256 vs itself, 120 games a batch | running |

Run locally (not a bucket job):

| what | settings | result |
|---|---|---|
| `lab/swings.mjs`: the judge against Korbi's kept games (game-records branch) | 39 replayable games (Monte won 27), judge at each turn start, both hands known | not calibrated badly in the middle (judge 35–50%: human won 39%; 50–65%: 52%) but overconfident for the human's leads (80–90%: won 65%); 10–20%: human won 1 of 24. A **sawtooth**: the verdict moves 10 points a half-turn and each move is half undone by the next (correlation −0.55); at the start of one's own turn the judge gives that player 8.1 ± 0.3 points less than on the turns either side. A judge that understood the game would only move on news |
| `lab/residuals.mjs` on Korbi's games | 39 games, judge vs result by land lead | the judge barely prices a mana lead: 2 more lands, judge 52%, won 73%; 3+ more 68% vs 85%; 3+ fewer 34% vs 25%; the slope holds for both the human and Monte to move. Their Dandân on the table at life 13+: judge 8 points too gloomy. Confirmation on self-play: job res1 |
| threat share screen (Medium urgency 2/3/4 vs Medium) | deals 0–299, local | 52.5 ± 1.6, 53.2 ± 1.3, 49.8 ± 1.0; urgency 3 to confirm on fresh deals: jobs as1m (Medium), as2h (Hard 64) |
| threat share with answers held and hand sizes (urgency 3 plus answerCut / handFade) | deals 0–299, local, vs Medium | answerCut 0.5: 52.5 ± 1.5; 0.5 + handFade 3: 52.3 ± 1.5; handFade 3: 52.8 ± 1.3; 0.8 + 3: 50.8 ± 1.7: none above urgency 3 alone (53.2 ± 1.3), not taken further for now |
| an1 | analysis judge: Korbi's games, Hard 2,048 deals with the other hand known, beside the judge | 884 positions, 39 games | the zigzag persists under the deep search (successive moves correlate −0.25 against −0.33; lean to the mover −1.8 against −4.2 points); predicts the result barely better (Brier 0.2132 against 0.2168): the search inherits the judge's errors |
| res1 | judge error by land/hand/Dandân on Hard self-play (no skill gap) | spb01, 120 games, 3,536 positions | the card lead is underpriced most (3+ more cards in hand: judge 57%, won 67%; 3+ fewer: 37% against 27%); the land lead less (1–2 more: +6 to +7 points); land lead 2+ with their Dandân at life 9+: 56% against 66% |
| jt01 | judge trained on spb01 (120 games), auto-queued | blend 0.5, 40 epochs, best at 5 | held-out self-play games: error against the result 0.1726 → 0.1596. Tested on Korbi's games in ar1/ar2 |
| as1m | threat share urgency 3, Medium vs Medium, fresh deals 1000–2199 | 1,200 pairs | not confirmed: 50.3% ± 0.7; the screen's 53.2 was noise |
| ar1 / ar2 | the game's judge against jt01 (trained on spb01) on Korbi's kept games | 39 games, 892 positions | jt01 predicts the result a little better (Brier 0.2038 → 0.1967) but still misses the land lead (2 more lands: judge 47%, won 73%); it learned self-play's card weighting, which overshoots in these games (3+ fewer cards: says 18%, won 44%). One batch is little; the curve over batches decides |
| end-step mana (manaCost at their end step 0 / 0.3 against 0.8) | 400 pairs, local | identical games (50.0 ± 0): Medium's reserve is already 0 at their end step, so mana there is already free; the setting was taken out again |
