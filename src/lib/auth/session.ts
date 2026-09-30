import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { AppError } from "../http/errors";
import { generateToken, hashToken } from "./password";

/** The shape the UI needs. Deliberately not the raw User row. */
export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  initials: string;
  role: Role;
  studentNumber: string | null;
  programName: string | null;
  studyYear: number | null;
  avatarHue: number;
}

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  studentNumber: true,
  studyYear: true,
  avatarHue: true,
  isActive: true,
  program: { select: { name: true } },
} as const;

type UserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  studentNumber: string | null;
  studyYear: number | null;
  avatarHue: number;
  isActive: boolean;
  program: { name: string } | null;
};

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`,
    initials: `${row.firstName[0] ?? ""}${row.lastName[0] ?? ""}`.toUpperCase(),
    role: row.role,
    studentNumber: row.studentNumber,
    programName: row.program?.name ?? null,
    studyYear: row.studyYear,
    avatarHue: row.avatarHue,
  };
}

export interface ClientContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export async function getClientContext(): Promise<ClientContext> {
  const headerList = await headers();
  // Left-most entry of X-Forwarded-For is the original client when the app
  // sits behind exactly one trusted proxy. Configure the proxy to overwrite,
  // never append, or this is attacker-controlled.
  const forwarded = headerList.get("x-forwarded-for");
  const ipAddress = forwarded ? (forwarded.split(",")[0] ?? "").trim() || null : null;
  return { ipAddress, userAgent: headerList.get("user-agent") };
}

function expiryFromNow(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

/**
 * Create a session and set the cookie.
 *
 * The raw token exists only in this function's stack and in the cookie; the
 * database stores `sha256(token)`, so a stolen dump cannot be replayed.
 *
 * `expiresAt` is the *earlier* of the absolute cap and the idle deadline, which
 * lets one column answer both "is this session still within its lifetime" and
 * "has this session been idle too long".
 */
export async function createSession(userId: string, context: ClientContext): Promise<void> {
  const token = generateToken();
  const now = new Date();
  const absoluteExpiry = expiryFromNow(env.session.maxAgeSeconds);
  const idleExpiry = expiryFromNow(env.session.idleTimeoutSeconds);
  const expiresAt = absoluteExpiry < idleExpiry ? absoluteExpiry : idleExpiry;

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      lastSeenAt: now,
      // Stored so the sessions screen can answer "where am I signed in?".
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    },
  });

  const store = await cookies();
  store.set(env.session.cookieName, token, {
    httpOnly: true,
    // `Lax` still sends the cookie on top-level navigation (so a link out and
    // back keeps you signed in) but not on cross-site POSTs. That is the CSRF
    // defence which costs no extra round-trip on every write.
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    expires: absoluteExpiry,
  });
}

export interface ResolvedSession {
  user: SessionUser;
  sessionId: string;
}

/**
 * Resolve the current session, or null.
 *
 * Idle timeout: `lastSeenAt` older than the idle window invalidates the
 * session, so a stolen cookie expires even if its absolute deadline has not
 * passed. Last-seen is only written when it has moved meaningfully, which keeps
 * this from becoming a write on every single request.
 */
const LAST_SEEN_WRITE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Resolve the signed-in session for this request.
 *
 * Wrapped in React's `cache` because it is the most widely called function in
 * the app and it costs a database round trip. The shell context needs it, the
 * page needs it, and the API guards need it; on a request where all three fire,
 * an uncached version issues the identical `sessions` lookup three times. At the
 * ~200ms round trip to the hosted database, two redundant reads are most of half
 * a second.
 *
 * It is safe to dedupe despite the side effects below. The writes are
 * conditional cleanups — an expired session is deleted, a stale `lastSeenAt` is
 * refreshed — and running them once instead of three times is the correct number
 * of times, not a skipped update.
 *
 * Outside a React render (a route handler calling `requireApiUser`, say) `cache`
 * has no request scope to memoise within and simply calls through, which is why
 * this cannot be relied on to deduplicate API traffic.
 */
export const getSession = cache(async (): Promise<ResolvedSession | null> => {
  const store = await cookies();
  const token = store.get(env.session.cookieName)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const now = new Date();
  const idleCutoff = expiryFromNow(-env.session.idleTimeoutSeconds);

  const row = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { select: USER_SELECT } },
    // Without this, Prisma loads the two relations one level per round trip:
    // `sessions`, then `users` for the included user, then `programs` for that
    // user's program name. Three statements to answer "who is signed in", on a
    // database roughly 200 ms away, and the two extra statements are pure
    // latency the answer does not need. `join` loads them through SQL joins in
    // the one statement instead. `USER_SELECT` is flat scalar columns plus a
    // single to-one relation, which is the shape this strategy is designed for.
    relationLoadStrategy: "join",
  });

  if (!row) return null;

  if (row.expiresAt <= now || row.lastSeenAt <= idleCutoff) {
    // Expired. Clean up so the table does not accumulate dead rows; a failure
    // here is not worth failing the request over.
    await prisma.session
      .delete({ where: { id: row.id } })
      .catch(() => undefined);
    return null;
  }

  if (!row.user.isActive) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }

  if (now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_WRITE_THRESHOLD_MS) {
    await prisma.session
      .update({ where: { id: row.id }, data: { lastSeenAt: now } })
      .catch(() => undefined);
  }

  return { user: toSessionUser(row.user), sessionId: row.id };
});

/**
 * Require a session. Redirects for page renders, throws for API calls — a
 * redirect from a fetch would hand the caller an HTML login page.
 */
export async function requireUser(): Promise<ResolvedSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** API-side equivalent: throws 401 rather than redirecting. */
export async function requireApiUser(): Promise<ResolvedSession> {
  const session = await getSession();
  if (!session) throw AppError.unauthenticated();
  return session;
}

/**
 * Require a role. Order matters: always call `requireApiUser` first so the
 * "who are you" check happens before the "may you" check.
 */
export async function requireRole(...allowed: Role[]): Promise<ResolvedSession> {
  const session = await requireApiUser();
  if (!allowed.includes(session.user.role)) {
    throw AppError.forbidden("Your account does not have access to this area.");
  }
  return session;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(env.session.cookieName)?.value;
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => undefined);
  }
  store.delete(env.session.cookieName);
}

/** Invalidate every session for a user. Called on password change. */
export async function destroyAllSessionsForUser(
  userId: string,
  exceptSessionId?: string,
): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
  });
}

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, ipAddress: true, lastSeenAt: true, createdAt: true },
    orderBy: { lastSeenAt: "desc" },
  });
}
