// The bot lab: tools to measure Dandan's computer player without touching the page. Imports the page's own modules.
export const J = x => JSON.parse(JSON.stringify(x));
export const hr = () => Number(process.hrtime.bigint()) / 1e6;     // ms
