Queue by commit (13 Nov 2026). A job spec put here as <id>.json and pushed to main is copied to jobs/<id>.json in the bucket by
.github/workflows/queue.yml (lab/queue-push.mjs): only if no job or retired job of that id exists, never overwritten, never
deleted. A spec without a 40-character ref gets the pushed commit's. After it is queued, move it to done/ (the copy kept with
the code it ran). done/ is never read by the pusher.
