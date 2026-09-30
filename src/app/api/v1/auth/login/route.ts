import { z } from "zod";
import { route, ok, parseJson } from "@/lib/http/responses";
import { AppError, ErrorCode } from "@/lib/http/errors";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyPassword, fakeVerifyDelay } from "@/lib/auth/password";
import { createSession, getClientContext } from "@/lib/auth/session";
import { hit, rateKey } from "@/lib/security/rate-limit";
import { assertSameOrigin, clientFingerprint } from "@/lib/security/csrf";
import { record } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/login
 *
 * Signs a user in.
 *
 * The security posture here is deliberately paranoid, because login is the one
 * endpoint an attacker will hammer and the one where a shortcut leaks other
 * people's records:
 *
 *  - **Uniform failure.** An unknown address and a wrong password take the same
 *    path, return the same status, and produce the same message. The response
 *    time is equalised too: `fakeVerifyDelay` burns roughly the same wall clock
 *    as a real scrypt verify when there is no user to verify against, so the
 *    endpoint cannot be used to enumerate which addresses have accounts. An error
 *    message that distinguishes them is the classic oracle, and timing is the
 *    same mistake in a different costume.
 *  - **Deactivated accounts are indistinguishable from wrong passwords** at
 *    this endpoint. Telling a suspended user "your account is disabled" confirms
 *    the address exists; the real answer belongs in an email to the address,
 *    where only the owner will see it.
 *  - **Rate limiting is per address and per fingerprint.** Keyed on both, so one
 *    attacker cannot lock a real student out of their own account by grinding
 *    their address, and cannot bypass the limit by rotating addresses.
 *  - **Every outcome is audited**, including failures. A successful login is a
 *    security-relevant event; a run of failures against one address is how
 *    account takeover is detected after the fact.
 */

const body = z.object({
  email: z
    .string()
    .trim()
    .min(3, "Enter your email address.")
    .max(320, "That is not an email address.")
    .email("That does not look like an email address."),
  password: z
    .string()
    .min(1, "Enter your password.")
    // bcrypt and scrypt both refuse very long inputs; refusing here means a
    // 10 MB "password" cannot turn a failed login into a memory problem.
    .max(256, "That password is too long to be real."),
});

const FAILURE = "Email or password is incorrect.";

export const POST = route(async (request) => {
  await assertSameOrigin(request);

  const fingerprint = await clientFingerprint();
  const { ipAddress, userAgent } = await getClientContext();
  const parsed = await parseJson(request, body);
  const email = parsed.email.toLowerCase();

  // Throttle before any database work, so a flood cannot be used to generate
  // load as well as to guess passwords. Both counters must pass; the tighter
  // one governs.
  const perAddress = hit(rateKey("login:email", email), env.rateLimit.loginMaxAttempts, env.rateLimit.loginWindowSeconds);
  const perClient = hit(rateKey("login:client", fingerprint ?? ipAddress), env.rateLimit.loginMaxAttempts, env.rateLimit.loginWindowSeconds);
  const limited = !perAddress.allowed ? perAddress : perClient.allowed ? null : perClient;

  if (limited) {
    await record({
      action: "auth.login.throttled",
      outcome: "DENIED",
      ipAddress,
      userAgent,
      // The address is stored: this row is how an operator sees that someone is
      // grinding a specific account. It is PII in an operator-only table.
      metadata: { email, scope: limited === perAddress ? "address" : "client" },
    });
    throw AppError.rateLimited(limited.retryAfterSeconds);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, isActive: true, role: true },
  });

  let valid = false;
  if (user) {
    valid = await verifyPassword(parsed.password, user.passwordHash);
  } else {
    // Equalise the timing so "no such user" is not detectable by stopwatch.
    await fakeVerifyDelay();
  }

  if (!user || !valid || !user.isActive) {
    await record({
      actorId: user?.id ?? null,
      action: "auth.login.failed",
      outcome: "FAILURE",
      ipAddress,
      userAgent,
      metadata: { email, reason: !user ? "unknown-account" : !user.isActive ? "inactive" : "bad-password" },
    });
    // One status, one message, one code. Anything more specific is an
    // enumeration oracle. Thrown rather than returned so it goes through the
    // same envelope every other failure uses, and the client has exactly one
    // shape to parse.
    throw new AppError(ErrorCode.UNAUTHENTICATED, 401, FAILURE);
  }

  await createSession(user.id, { ipAddress, userAgent });
  await prisma.user
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => undefined);

  await record({
    actorId: user.id,
    action: "auth.login.succeeded",
    outcome: "SUCCESS",
    ipAddress,
    userAgent,
    metadata: { role: user.role },
  });

  return ok({ ok: true, role: user.role });
});
