// Where does the time actually go?
//
// The instinct when a page takes three seconds is to blame rendering. On a
// server-rendered page that reads a remote database, that instinct is usually
// wrong: three seconds of a term page is almost always a handful of sequential
// round-trips to a Postgres that is a long way away, each one costing real
// network time and none of them overlapping.
//
// This measures the two things that have to be true for that diagnosis to hold:
// the latency of a single trivial query, and how many queries a page issues.
// The first says whether parallelism can help at all. The second says how much
// there is to parallelise.
//
// Usage: node scripts/db-latency.mjs [baseUrl]

const base = process.argv[2] ?? "http://127.0.0.1:3000";

// Next.js loads `.env` for the app itself, so anything run outside it has to do
// the same or `new PrismaClient()` fails on a missing `DATABASE_URL` — which
// reads as "cannot reach the database" rather than "you forgot to load the env",
// and sends you looking at the wrong problem.
//
// `@next/env` is CommonJS, so the named export is not on the namespace object;
// it is reachable through `default` (or `module.exports`).
const { default: nextEnv } = await import("@next/env");
nextEnv.loadEnvConfig(process.cwd());

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function timed(label, run) {
  const started = performance.now();
  const value = await run();
  const ms = performance.now() - started;
  console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${label}`);
  return { ms, value };
}

console.log("=== single-query latency (warm) ===");
await prisma.$queryRaw`SELECT 1`;
const samples = [];
for (let i = 0; i < 5; i++) {
  const { ms } = await timed("SELECT 1", () => prisma.$queryRaw`SELECT 1`);
  samples.push(ms);
}
samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
console.log(`  median round trip: ${median.toFixed(0)} ms`);
console.log(
  `  at that latency, a page issuing N sequential queries costs about ${(median * 7 / 1000).toFixed(2)} s`,
);

console.log("\n=== what a page actually costs, end to end ===");
const login = await fetch(`${base}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({
    email: "anirban.banerjee@college.edu",
    password: "folio-demo-2026",
  }).replace("anirban.banerjee", "maya.krishnan"),
});
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");

for (const path of ["/today", "/term", "/grades", "/finance", "/settings"]) {
  // First hit compiles nothing on a production build, so this is steady state.
  await fetch(`${base}${path}`, { headers: { cookie } });
  const { ms } = await timed(`GET ${path}`, () =>
    fetch(`${base}${path}`, { headers: { cookie } }),
  );
  console.log(`         ${(ms / Math.max(median, 1)).toFixed(1)}x one round trip`);
}

await prisma.$disconnect();
