// Which deals one worker plays: the pairs 0..P-1 are split as evenly as they go over jobs x processes, in runs of
// neighbours (the first P mod W workers take one more). usage: node shard.mjs <pairs> <jobs> <processes a job> <job> <process>
// prints "<first pair> <how many>".
const [P, jobs, procs, job, proc] = process.argv.slice(2).map(Number);
const W = jobs * procs, w = job * procs + proc, base = Math.floor(P / W), extra = P % W;
console.log(`${w * base + Math.min(w, extra)} ${base + (w < extra ? 1 : 0)}`);
