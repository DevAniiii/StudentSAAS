import "server-only";

import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "./env";

/**
 * Prisma client singleton.
 *
 * Next.js dev mode hot-reloads modules on every edit. Without the global cache
 * each reload would open a fresh connection pool and eventually exhaust the
 * database's connection limit, so the client is stashed on `globalThis` in
 * development only. In production there is exactly one module instance and
 * `globalThis` is left untouched.
 *
 * The exported client keeps the bare `PrismaClient` type on purpose. Prisma
 * derives the events `$on` accepts from the `log` array in the client's options,
 * and the default generic has no `log`, so every event type collapses to `never`.
 * Widening the exported type to fix the trace would push that inference problem
 * into every file that imports `prisma`, to serve one debugging switch. So the
 * trace re-states the type it needs locally, and casts exactly once.
 */
type Client = PrismaClient;

/**
 * A client with the `query` level enabled, which is what `QUERY_TRACE` asks for
 * when `DB_TRACE=1`. Named for the only thing it is used for.
 */
type TracedClient = PrismaClient<{
  log: ["warn", "error", { level: "query"; emit: "event" }];
}>;

const globalForPrisma = globalThis as unknown as {
  prisma: Client | undefined;
};

/**
 * Whether to emit one line per query. See the trace block below for what it is
 * for and why it is off unless asked for.
 *
 * Read from `process.env` directly rather than through `env`: the trace is a
 * debugging switch rather than something the app should refuse to start without,
 * and it has to be decided while the client is being *constructed*.
 */
const TRACE_QUERIES = process.env.DB_TRACE === "1";

/**
 * Per-query trace, off unless `DB_TRACE=1`.
 *
 * A page served by a remote database is slow for a reason that is invisible from
 * the outside: it is not rendering that costs, it is the number of *sequential*
 * round trips. A query awaited behind another waits for it; queries started
 * together overlap, but only as far as the connection pool allows, and they stay
 * separate statements. Nothing in a response header or a log line says which of
 * those a request did, and guessing from a total is how people end up optimising
 * the renderer when the renderer was never the problem.
 *
 * One JSON line per query, timestamped, so the waves are recoverable: queries
 * that start within a few tens of milliseconds of each other overlapped and cost
 * one round trip of wall time; a query that starts after the previous one
 * finished was serialised and cost a second. `scripts/query-waves.mjs` reads a
 * trace and prints the grouping.
 *
 * `emit: "event"` routes the event to `$on` listeners instead of straight to
 * stdout, which is the only reason this needs the local cast above: a
 * `LogDefinition` chooses a *destination*, it is not a callback.
 *
 * Off by default. A line per statement on a hot path is an availability risk, not
 * a debugging aid, so this is opt-in and the app never enables it for itself.
 */
const QUERY_TRACE: Prisma.LogDefinition = { level: "query", emit: "event" };

function createClient(): Client {
  return new PrismaClient({
    // Log queries in development so N+1s are visible while building. Bound to
    // `warn`+`error` in production; a verbose query log on a hot path is an
    // availability risk, not a debugging aid.
    log: [
      ...(env.isDev ? (["warn"] as const) : []),
      "error",
      ...(TRACE_QUERIES ? [QUERY_TRACE] : []),
    ],

    datasources: { db: { url: env.databaseUrl } },
  });
}

export const prisma: Client = globalForPrisma.prisma ?? createClient();

if (env.isDev) {
  globalForPrisma.prisma = prisma;
}

// Registered after the client exists, and only when the trace was asked for at
// construction time — the two must agree, since the level has to be in the `log`
// array for `$on` to receive anything.
if (TRACE_QUERIES) {
  (prisma as TracedClient).$on("query", (event) => {
    console.log(
      JSON.stringify({
        level: "info",
        component: "db",
        action: "query",
        at: event.timestamp.getTime(),
        ms: event.duration,
        model: event.target,
        sql: event.query.replace(/\s+/g, " ").slice(0, 200),
      }),
    );
  });
}

/**
 * Fail at boot, not on the first request, if the database is unreachable.
 *
 * Without this, a misconfigured `DATABASE_URL` produces a 500 on whichever route
 * happens to be hit first, with the real cause buried in a Prisma log line. The
 * symptom — "the app is broken" — is nowhere near the cause, and the two are
 * separated by however long it takes to read a stack trace.
 *
 * The failure this was written for is a specific and expensive one: a password
 * containing `$`, written literally in `.env`. Two readers of that file disagree
 * about it. Next.js loads it through `@next/env`, which runs `dotenv-expand` and
 * truncates the value at the `$`, so the app authenticates with a short password.
 * The Prisma CLI does no expansion, so escaping the `$` as `\$` fixes the app and
 * breaks the CLI, which now sends a literal backslash. No spelling of a bare `$`
 * satisfies both, and each one works in isolation — which is what makes the
 * credentials look right until the wrong reader is the one in use. Percent-encoding
 * it as `%24` satisfies both. See the note in `.env.example`.
 *
 * So: one connection attempt at startup, and if it fails, say what failed and
 * say what to check. Retried a few times with a short backoff, because the
 * Supabase pooler reliably refuses the first connection after a cold start and
 * succeeds a moment later — treating that as a fatal misconfiguration would
 * train people to ignore this message, which defeats the point of having it.
 *
 * Never throws. A boot check that can take the process down is worse than the
 * 500 it prevents: a missing database should degrade the app, not delete it.
 */
void (async () => {
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      // Prisma's messages are wrapped and usually *start* with a blank line, so
      // `split("\n")[0]` yields the empty string — a log that says "the
      // connection failed" with a blank reason field is worse than no log,
      // because it reads as though the cause were unknown.
      const reason =
        error instanceof Error
          ? (error.message.split("\n").find((line) => line.trim() !== "") ?? error.message)
          : String(error);
      if (attempt === ATTEMPTS) {
        console.error(
          JSON.stringify({
            level: "error",
            component: "db",
            action: "connect-failed",
            attempts: ATTEMPTS,
            message: reason,
            // The two causes that account for almost every occurrence, in the
            // order they turn out to be true. Both are silent in the sense that
            // nothing anywhere else reports them.
            hint:
              "Two causes account for nearly all of these. If a reserved character in the " +
              "password in .env was written literally rather than percent-encoded, the two " +
              "readers of that file disagree: Next.js runs dotenv-expand over it and " +
              "truncates the value at a bare `$`, while the Prisma CLI does not expand and so " +
              "sends a `\\$` as a literal backslash. Percent-encode it instead — `%24` for `$` — " +
              "which both parsers read as the same password. If nothing works, check that " +
              "DATABASE_URL points at the regional pooler " +
              "(aws-0-<region>.pooler.supabase.com) with the project ref in the username; the " +
              "direct host db.<ref>.supabase.co often resolves to IPv6-only and will not accept " +
              "a connection. See the note in .env.example.",
          }),
        );
        return;
      }
      // Linear backoff: 400ms, 800ms. Short enough not to slow a healthy boot,
      // long enough to clear the pooler's cold-start refusal.
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
})();
