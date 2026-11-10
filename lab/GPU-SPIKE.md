# GPU spike: can Hard's look-ahead run on a graphics card?

Korbi, 10 November 2026: three ways to make the lab cheaper — faster code (bit-identical), smarter search (drop clearly
worse moves early), and the GPU, "the biggest upside if it works". He has an RTX 3080 on a Windows PC; no card is rented.

## Why it is not a port

A GPU runs thousands of games at once only if every game takes the same instruction at the same time. Dandan's rules
and, worse, Medium's decision code (44% of a Hard move's time, hundreds of hand-written rules) branch at every step, so
ported as they are they would run no faster. Published work that made a branchy card game fast on GPUs (Mahjax, riichi
mahjong in JAX, 2026) rewrote the rules as masked array maths, and its eight A100s beat one fast CPU simulator by 10×.

## What would make it pay

1. The rules engine as fixed arrays (hands, library, battlefield, stack as tensors), every rule applied to a batch of
   games at once with masks for the games it doesn't apply to.
2. Medium replaced, not ported: a small network trained to copy Medium's choices (a policy network), which is pure
   matrix maths. Later it can learn past Medium by self-play, the way to clever lines no rule-writer thinks of.
3. The judge already is a network; it moves as it is.

## The spike (1–2 days), PyTorch on Windows

PyTorch, not JAX: JAX uses an NVIDIA card on Windows only through WSL (admin rights, a restart); PyTorch uses it with a
plain install. Delivered as one file to double-click, which installs what it needs, runs, and writes its numbers to the
lab bucket.

- Core rules only, as tensors: land drops, Dandân (casting, attacking, its Island needs), draws, Memory Lapse; moves
  chosen at random among the legal ones.
- Measure games per second on the 3080 at batch sizes 1k–64k, against the JavaScript engine on one CPU core playing the
  same cut-down game with random moves.
- Fidelity check: the same random choices replayed through both engines must give the same games.

## The bar

A rented GPU costs about what 12–16 spot cores do; the 3080 costs nothing but power. Go on to the full engine only if
the cut-down game runs at least 20× faster on the 3080 than on one core, since the full rules will lose some of that.
Under that, stop: the CPU lab with faster code and the smarter search is the cheaper road.

## Built (10 November 2026)

- `lab/gpu/mini.mjs`: the cut-down game one game at a time, branching, as the real engine is written.
- `lab/gpu/mini.py`: the same game in PyTorch, every game of a batch stepped at once with masks. Same random numbers
  (xorshift32, six a turn whatever happens), so the same seeds give the same games: checked on 3,000 games, all equal
  (winner, turns, lives), and the win counts of 100,000 equal too.
- `lab/gpu/run-gpu-spike.bat`: for Korbi's PC. Double-click; it fetches both from the site, uses the CUDA PyTorch Forge
  already installed (else Python 3.12's, else installs one), runs the benchmark, and puts the result in Notepad and
  on the clipboard.

First numbers, on the lab's sandbox (no GPU): JavaScript, one core, 180,000–280,000 games a second; PyTorch on two CPU
threads, 78,000 at a batch of 100,000. The bar for the 3080: about 20 times one core, some 4–5 million games a second.
