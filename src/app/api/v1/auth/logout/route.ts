import { route, ok } from "@/lib/http/responses";
import { destroySession, getClientContext, getSession } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/security/csrf";
import { record } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/logout
 *
 * Signs the current session out and clears the cookie.
 *
 * Idempotent by design. Signing out when you are not signed in is not an error —
 * it is the state the caller asked for, already true. Returning 401 here would
 * mean a double-clicked sign-out button shows an error, and a sign-out link in a
 * shared browser's history showing one too.
 *
 * A failed `DELETE` of the session row is swallowed by `destroySession`, which
 * also clears the cookie regardless. The cookie is the credential; the row is
 * only a record that it was valid. So the user ends up signed out either way, and
 * the orphaned row expires on its own.
 */

export const POST = route(async (request) => {
  await assertSameOrigin(request);

  // Resolved before the session is destroyed, because after it there is nothing
  // to read and the audit entry needs an actor.
  const [session, { ipAddress, userAgent }] = await Promise.all([
    getSession(),
    getClientContext(),
  ]);

  await destroySession();

  await record({
    actorId: session?.user.id ?? null,
    action: "auth.logout",
    ipAddress,
    userAgent,
  });

  return ok({ ok: true });
});
