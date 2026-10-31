// Which deals one worker plays: the pairs offset..offset+P-1 are split as evenly as they go over jobs x processes, in
// runs of neighbours (the first P mod W workers take one more, and with fewer pairs than workers the rest play none).
// usage: node shard.mjs <pairs> <jobs> <processes a job> <job> <process> [<first pair, 0>]; prints "<first pair> <how many>".
const [P, jobs, procs, job, proc, offset = 0] = process.argv.slice(2).map(Number);
const W = jobs * procs, w = job * procs + proc, base = Math.floor(P / W), extra = P % W;
console.log(`${offset + w * base + Math.min(w, extra)} ${base + (w < extra ? 1 : 0)}`);
