// Group a DB_TRACE log into waves, and show what each page actually paid for.
//
// A page served by a remote database is slow for a reason that is invisible from
// the outside: it is not rendering that costs, it is the number of *sequential*
// round trips. A query awaited behind another waits for it; queries started
// together overlap, but they stay separate statements and the pool decides how
// many can be in flight. Only the serial count is worth optimising, and it cannot
// be read off a response time.
//
// So this reads the per-query trace `src/lib/db.ts` emits when `DB_TRACE=1`,
// buckets the queries into waves by when they started, and reports both. A wave
// whose queries all began at once was already overlapped; a wave that begins after
// the previous one finished is a round trip the page chose to serialise.
//
// Usage:  DB_TRACE=1 next start
//         node scripts/query-waves.mjs <logfile>

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/query-waves.mjs <server-log>");
  process.exit(1);
}

const lines = readFileSync(path, "utf8").split(/\r?\n/);

const queries = [];
for (const line of lines) {
  if (!line.includes('"component":"db"')) continue;
  try {
    const event = JSON.parse(line.slice(line.indexOf("{")));
    if (event.action !== "query") continue;
    // `at` is emitted as epoch milliseconds, but a trace written by an older
    // build, or one read back from a log that round-tripped through a date
    // parser, can hold an ISO string. Coerce once here rather than trusting the
    // shape: an unparsed timestamp makes every comparison `NaN`, and `NaN > gap`
    // is false, so the whole trace silently collapses into a single wave — which
    // reads as "this page parallelised everything" and is the opposite of the
    // likely truth.
    const at = typeof event.at === "number" ? event.at : Date.parse(event.at);
    if (Number.isNaN(at)) continue;
    queries.push({ ...event, at });
  } catch {
    // A log line can be truncated mid-JSON if the process was killed; skip it
    // rather than abandoning the whole trace.
  }
}

if (queries.length === 0) {
  console.error("no query events found — was DB_TRACE=1 set when the server started?");
  process.exit(1);
}

queries.sort((a, b) => a.at - b.at);

// A gap longer than this between query starts means the next query could not
// have been in the same batch, so it is a new wave. 40ms is well above the
// sub-millisecond spread within a tick and well below the ~160ms round trip.
const GAP_MS = 40;

const waves = [];
let current = null;
for (const q of queries) {
  if (!current || q.at - current.startedAt > GAP_MS) {
    current = { startedAt: q.at, endedAt: q.at, items: [] };
    waves.push(current);
  }
  current.items.push(q);
  current.endedAt = Math.max(current.endedAt, q.at + q.ms);
}

console.log(`${queries.length} queries in ${waves.length} waves\n`);

for (const [index, wave] of waves.entries()) {
  const wall = wave.endedAt - wave.startedAt;
  const gap = index === 0 ? 0 : wave.startedAt - waves[index - 1].endedAt;
  console.log(
    `wave ${String(index + 1).padStart(2)}  ` +
      `${String(wave.items.length).padStart(2)} queries  ` +
      `${String(wall.toFixed(0)).padStart(5)} ms wall  ` +
      `${gap > GAP_MS ? `(+${gap.toFixed(0)} ms serial wait)` : ""}`,
  );
  for (const q of wave.items) {
    const model = String(q.model ?? "").padEnd(12);
    console.log(`            ${String(q.ms.toFixed(0)).padStart(4)} ms  ${model} ${q.sql.slice(0, 110)}`);
  }
}

let serial = 0;
for (let i = 1; i < waves.length; i++) {
  const gap = waves[i].startedAt - waves[i - 1].endedAt;
  if (gap > 0) serial += gap;
}
console.log(`\ntime lost to serialisation: ${serial.toFixed(0)} ms`);
console.log(`time inside the database:  ${queries.reduce((s, q) => s + q.ms, 0).toFixed(0)} ms`);
