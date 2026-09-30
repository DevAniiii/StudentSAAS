import { z } from "zod";
import { route, ok, parseJson } from "@/lib/http/responses";
import { AppError } from "@/lib/http/errors";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getClientContext, requireApiUser, destroyAllSessionsForUser } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/security/csrf";
import { clientFingerprint } from "@/lib/security/csrf";
import { hit, rateKey } from "@/lib/security/rate-limit";
import { record } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/password
 *
 * Changes the signed-in user's password.
 *
 * The current password is required. Without that check, anyone who walks up to an
 * unlocked machine can take over the account, and "someone changed my password"
 * is not a position a student can recover from.
 *
 * Every *other* session is destroyed on success. The realistic reason to change a
 * password is a belief that it has leaked, and leaving a leaked session alive
 * would leave the account exactly as exposed as before — the change would be
 * theatre. The session making the change survives, because forcing an immediate
 * re-login on the device the student just used reads as a failure and would make
 * people avoid the very control that protects them.
 *
 * Verification cost is the point. scrypt runs with parameters that take long
 * enough to be expensive, which is why the attempt counter exists: a
 * rate-limited endpoint that still burns a scrypt verify per request is a
 * denial-of-service lever, and one that does not is a password oracle. The
 * counter is checked first and the verify second, which is the order that
 * matters.
 */

const body = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(256),
  newPassword: z
    .string()
    .min(10, "Use at least 10 characters. Length does more than symbols.")
    .max(256, "That password is too long to be real.")
    // A single repeated character or a lone dictionary-free run passes any
    // length rule and is worth rejecting outright. This is a floor, not a
    // strength meter — see the copy in `session-panel.tsx`.
    .refine((value) => new Set(value).size >= 5, {
      message: "Use a mix of characters, not the same one repeated.",
    }),
});

export const POST = route(async (request) => {
  await assertSameOrigin(request);

  const { user, sessionId } = await requireApiUser();
  const { ipAddress, userAgent } = await getClientContext();
  const fingerprint = await clientFingerprint();

  const limit = hit(
    rateKey("password", user.id, fingerprint ?? ipAddress),
    5,
    15 * 60,
  );
  if (!limit.allowed) {
    await record({
      actorId: user.id,
      action: "auth.password.throttled",
      outcome: "DENIED",
      ipAddress,
      userAgent,
    });
    throw AppError.rateLimited(limit.retryAfterSeconds);
  }

  const parsed = await parseJson(request, body);

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true },
  });
  if (!row) throw AppError.notFound("Account");

  const currentValid = await verifyPassword(parsed.currentPassword, row.passwordHash);
  if (!currentValid) {
    await record({
      actorId: user.id,
      action: "auth.password.denied",
      outcome: "DENIED",
      ipAddress,
      userAgent,
      metadata: { reason: "current-password-mismatch" },
    });
    // A field error, not a bare 401: the form has to be able to say *which*
    // field is wrong, and that is only useful to someone already signed in.
    throw AppError.validation(
      [{ path: "currentPassword", message: "That is not your current password." }],
      "Your password was not changed.",
    );
  }

  if (parsed.currentPassword === parsed.newPassword) {
    throw AppError.validation(
      [{ path: "newPassword", message: "Choose something different from your current password." }],
      "Your password was not changed.",
    );
  }

  // The new hash is computed *before* the row is written, so a slow or failing
  // hash never leaves the user signed out of a still-valid account.
  const passwordHash = await hashPassword(parsed.newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  const invalidated = await destroyAllSessionsForUser(user.id, sessionId);

  await record({
    actorId: user.id,
    action: "auth.password.changed",
    outcome: "SUCCESS",
    ipAddress,
    userAgent,
    metadata: { otherSessionsInvalidated: invalidated },
  });

  return ok({ ok: true, otherSessionsInvalidated: invalidated });
});
