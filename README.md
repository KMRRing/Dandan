Every game of every bot match run by the "Bot match" workflow of the main branch, kept as it is played:
`results/<candidate>-<champion>-d<search deals>/` holds `games.jsonl` (one line a game), `verdict.json` (what the rule
in lab/sequential.mjs says so far) and `log.txt` (the verdict after each batch). Written by the workflow; not by hand.
