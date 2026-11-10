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
