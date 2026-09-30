// How many concurrent connections will the pooler actually give us?
//
// This matters because Prisma's pool size is a latency dial: with a small pool,
// queries that could overlap queue behind each other, and a page that issues six
// of them waits for the slowest instead of the sum. With too large a pool, the
// pooler starts refusing connections outright — which looks exactly like the
// database being down, and is easy to misdiagnose as a network problem.
//
// So this measures the ceiling instead of guessing at it, and reports it as the
// largest N where every connection came up.
//
// Usage: node scripts/pool-ceiling.mjs [baseUrl] [max]

const { default: nextEnv } = await import("@next/env");
nextEnv.loadEnvConfig(process.cwd());

const { PrismaClient } = await import("@prisma/client");

const max = Number(process.argv[3] ?? 16);

/** `new PrismaClient({datasources})` bypasses the URL, so each client is pinned. */
async function tryPool(n) {
  const clients = [];
  try {
    for (let i = 0; i < n; i++) {
      const client = new PrismaClient({
        datasources: { db: { url: `${process.env.DATABASE_URL}&connection_limit=1` } },
      });
      clients.push(client);
      // Opened eagerly and concurrently: a pooler that is over its limit rejects
      // the surplus at connect time, so a sequential probe would never see it.
      await Promise.all(clients.map((c) => c.$queryRaw`SELECT 1`));
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { ok: false, message };
  } finally {
    await Promise.allSettled(clients.map((c) => c.$disconnect()));
  }
}

let ceiling = 0;
for (let n = 1; n <= max; n++) {
  const { ok, message } = await tryPool(n);
  if (ok) {
    ceiling = n;
    console.log(`  ${String(n).padStart(2)} concurrent connections: ok`);
  } else {
    console.log(`  ${String(n).padStart(2)} concurrent connections: FAILED — ${message}`);
    break;
  }
}

console.log(`\nceiling: ${ceiling} concurrent connections`);
console.log(
  ceiling === 0
    ? "not even one connection — this is not a pool-size problem, the database is unreachable"
    : `set connection_limit=${ceiling} (or lower) in DATABASE_URL`,
);
