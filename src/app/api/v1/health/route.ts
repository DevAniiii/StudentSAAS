import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createRequestId } from "@/lib/http/errors";

export const runtime = "nodejs";
// Never cached and never statically optimised: a health check that a CDN serves
// from memory is a health check that reports the CDN's health.
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health
 *
 * The one endpoint a load balancer, an uptime monitor, or a person with `curl`
 * can call without credentials.
 *
 * Two properties make it worth the extra surface area it adds:
 *
 *  - It distinguishes "the process is up" from "the app is usable". A server
 *    that is running but cannot reach its database is returning 200 to every
 *    request handler, which is precisely the state a naive uptime check calls
 *    healthy. Answering 503 when the database is unreachable is the difference
 *    between a monitor that pages someone and one that does not.
 *
 *  - It reports *which* dependency is down. A single boolean in a load balancer
 *    tells an operator nothing; this returns a named check.
 *
 * Deliberately unauthenticated and deliberately boring: no database rows are
 * read, no user data is touched, `SELECT 1` only. That keeps it safe to expose
 * and safe to call in a hot loop. The `checks` map is a fixed set of names with
 * only `ok`/`down` values, so nothing about the deployment leaks through it —
 * no host, no version of anything, no error text. A health endpoint that
 * reports why it failed is a reconnaissance gift, and the detail belongs in the
 * server log, where the boot check in `db.ts` already puts it.
 */
export async function GET(): Promise<NextResponse> {
  const requestId = createRequestId();
  const checks: Record<string, "ok" | "down"> = {};

  // Bounded so a wedged database cannot turn a health check into an outage of
  // its own. 3s is generous for `SELECT 1` and still short enough to be below
  // the typical 5s probe interval, so a slow database reads as down rather than
  // as a hung monitor.
  const timeout = new Promise<"down">((resolve) => {
    const timer = setTimeout(() => resolve("down"), 3_000);
    // Node would otherwise hold the event loop open for the full 3s on every
    // healthy call, because the timer is still pending.
    timer.unref?.();
  });

  try {
    const result = await Promise.race([
      prisma.$queryRaw`SELECT 1`.then(() => "ok" as const),
      timeout,
    ]);
    checks.database = result;
  } catch {
    // Swallowed on purpose. The reason is logged by the boot check and would be
    // an auth or network detail that does not belong in an unauthenticated
    // response; all the caller needs to know is that it is down.
    checks.database = "down";
  }

  const healthy = Object.values(checks).every((status) => status === "ok");

  return NextResponse.json(
    {
      data: {
        status: healthy ? "ok" : "degraded",
        checks,
        service: env.observability.serviceName,
        version: env.observability.version,
      },
      requestId,
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "cache-control": "no-store, private",
        "x-request-id": requestId,
      },
    },
  );
}
