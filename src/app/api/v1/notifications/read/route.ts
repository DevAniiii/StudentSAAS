import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/security/csrf";
import { record } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * POST /api/v1/notifications/read
 *
 * Marks every unread notification as read.
 *
 * Not wrapped in `route()` and not a JSON endpoint, because it is submitted by a
 * plain `<form>` from the announcements page — a plain form works without
 * JavaScript, and a portal that stops working when a script fails to load is not
 * a portal that works. The response is a redirect for the same reason: a
 * successful POST must not leave the user on a URL that re-submits on refresh.
 *
 * Same-origin is still enforced. `SameSite=Lax` does not stop a same-site
 * subdomain from POSTing here, and the action is a state change on the user's
 * own record, so the origin check stays.
 *
 * The `where` is `readAt: null` rather than every row. Rewriting `readAt` on
 * notifications the user read weeks ago would be a lie about when they read
 * them, and it would churn rows for no benefit.
 */

export async function POST(request: Request): Promise<NextResponse> {
  await assertSameOrigin(request);

  // `requireUser` redirects to /login for an unauthenticated page request, which
  // is the right failure mode for a form post and avoids leaking a 401 to a
  // browser that cannot render one.
  const { user } = await requireUser();

  const { count } = await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  await record({
    actorId: user.id,
    action: "notifications.marked_all_read",
    metadata: { count },
  });

  // Back to the page the form was on, not a hard-coded `/announcements`: the same
  // control appears on other screens, and redirecting to the wrong one would
  // move the user out from under the action they just take.
  const destination = safeBack(request.headers.get("referer"), request.url);

  // The `Location` is emitted **relative**, not resolved against `request.url`.
  //
  // Resolving it would bake an absolute origin into the header, and the origin of
  // `request.url` is reconstructed by the runtime from the `Host` header — so the
  // redirect would name `localhost:3000` to a browser that reached the app at
  // `127.0.0.1:3000`, and a different host again behind a proxy that rewrites
  // `Host`. That is a redirect that leaves the origin the user is on, which is
  // exactly the class of bug this endpoint is guarding against.
  //
  // A relative `Location` is also the strongest form of the guarantee available:
  // it cannot name a host, so it cannot be an open redirect, whatever
  // `safeBack` returns. `safeBack` still filters, so the guarantee does not rest
  // on the relative form alone.
  return new NextResponse(null, {
    // 303 so the browser follows with GET. A 302 after a POST is honoured as GET
    // by every current browser, but 303 says so explicitly and survives
    // intermediaries.
    status: 303,
    headers: {
      location: destination,
      "cache-control": "no-store",
    },
  });
}

/**
 * Only same-origin paths from the `Referer`.
 *
 * The same open-redirect reasoning as `?next=` on the login page: this value
 * goes straight into a redirect, so a crafted `Referer` would send a signed-in
 * student to an attacker-controlled page immediately after clicking a harmless
 * button. The header is trivially spoofable by a non-browser client, which is
 * exactly why it cannot be trusted to name an external host.
 *
 * `selfUrl` is the incoming request's own URL, which the runtime has already
 * established is this deployment. Passed in rather than read from a module global
 * so the function stays pure.
 */
function safeBack(referer: string | null, selfUrl: string): string {
  const fallback = "/announcements";
  if (!referer) return fallback;
  try {
    const target = new URL(referer);
    if (target.origin !== new URL(selfUrl).origin) return fallback;
    return onlyLocalPath(`${target.pathname}${target.search}`, fallback);
  } catch {
    // A malformed `Referer` is not an error worth surfacing; the user still
    // gets a sensible destination.
    return fallback;
  }
}

/**
 * Assert that a value is a same-origin *path*, not a URL in disguise.
 *
 * The `Location` header this feeds is relative, which is the real guarantee
 * against an open redirect. This is the second lock, and it is here so that the
 * guarantee survives a future edit: `//evil.example` and `/\evil.example` are both
 * absolute URLs to a browser despite beginning with a slash, and both are
 * rejected here rather than at the point of use, where the next reader is less
 * likely to be looking for them.
 *
 * Anything that is not exactly one leading slash followed by a non-slash
 * character falls back.
 */
function onlyLocalPath(value: string, fallback: string): string {
  return /^\/[^/\\]/.test(value) ? value : fallback;
}
