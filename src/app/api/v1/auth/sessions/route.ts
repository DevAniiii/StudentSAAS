import { z } from "zod";
import { route, ok, parseJson } from "@/lib/http/responses";
import { AppError } from "@/lib/http/errors";
import { prisma } from "@/lib/db";
import { getClientContext, requireApiUser } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/security/csrf";
import { record } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * DELETE /api/v1/auth/sessions
 *
 * Revokes sessions. Either one named session, or all of them.
 *
 * The authorisation rule is worth spelling out because it is the kind of thing
 * that gets missed and is then a session-fixation hole: a user may only delete a
 * session **belonging to themselves**, and the check is a `deleteMany` whose
 * `where` includes `userId`. A `delete({ where: { id } })` against a primary key
 * alone would let any authenticated user revoke any other user's session — a
 * denial-of-service against arbitrary accounts, and one that would look like it
 * worked.
 *
 * The current session may be revoked this way. "Sign out everywhere" is supposed
 * to include the device you clicked it on, and a guard against self-revocation
 * would be a special case that surprises exactly the people who need it most.
 * The client hard-navigates afterwards, so the dead cookie is cleared rather
 * than left in place.
 */

const body = z
  .object({
    all: z.boolean().optional(),
    sessionId: z.string().min(1).optional(),
  })
  .refine((value) => value.all === true || typeof value.sessionId === "string", {
    message: "Provide either `all: true` or a `sessionId`.",
    path: ["sessionId"],
  });

export const DELETE = route(async (request) => {
  await assertSameOrigin(request);

  const { user, sessionId: currentId } = await requireApiUser();
  const { ipAddress, userAgent } = await getClientContext();
  const parsed = await parseJson(request, body);

  if (parsed.all === true) {
    // Including the current session, deliberately. See the doc comment.
    const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });
    await record({
      actorId: user.id,
      action: "auth.sessions.revoked_all",
      ipAddress,
      userAgent,
      metadata: { count, selfIncluded: currentId !== null },
    });
    return ok({ ok: true, revoked: count });
  }

  const target = parsed.sessionId as string;
  const { count } = await prisma.session.deleteMany({
    where: { id: target, userId: user.id },
  });

  if (count === 0) {
    // Either it does not exist, or it belongs to someone else. The two are
    // reported identically, because distinguishing them confirms that an id is
    // a real session — a small leak, and one that costs nothing to avoid.
    throw AppError.notFound("Session");
  }

  await record({
    actorId: user.id,
    action: "auth.sessions.revoked",
    resource: "session",
    resourceId: target,
    ipAddress,
    userAgent,
    metadata: { self: target === currentId },
  });

  return ok({ ok: true, revoked: count });
});
