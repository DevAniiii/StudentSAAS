import "server-only";

import { cache } from "react";
import type { DensityPreference, ThemePreference } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { calendarDateIn, daysBetween, termPosition } from "@/lib/dates";
import { getSession, type SessionUser } from "@/lib/auth/session";

/**
 * Request-scoped context.
 *
 * Wrapped in React's `cache` so a layout and two nested pages that all need the
 * signed-in user resolve it once per request instead of once per component
 * tree. Without this, a shared shell plus a page plus a sidebar badge would
 * issue three identical `users` queries on every navigation.
 */

export interface TermContext {
  id: string;
  code: string;
  name: string;
  startsOn: Date;
  endsOn: Date;
  weekCount: number;
  status: string;
  week: number;
  progress: number;
  daysRemaining: number;
  isBeforeTerm: boolean;
  isAfterTerm: boolean;
}

export interface PreferencesContext {
  theme: ThemePreference;
  density: DensityPreference;
  weekStartsOn: number;
  timezone: string;
  notify: {
    assignmentDue: boolean;
    gradePosted: boolean;
    announcement: boolean;
    messages: boolean;
    paymentDue: boolean;
  };
}

export interface ShellContext {
  user: SessionUser;
  preferences: PreferencesContext;
  /** Effective timezone: the user's override, else the institution's. */
  timezone: string;
  /** True when `today` (in the effective zone) falls inside the term. */
  term: TermContext | null;
  counts: {
    unreadMessages: number;
    unreadNotifications: number;
    /** Assessments due within the next 72 hours and not yet submitted. */
    dueSoon: number;
  };
  now: Date;
}

/**
 * The active term: prefer the one explicitly in progress, else the nearest
 * upcoming, else the most recent completed. Returns null only if no term has
 * ever been configured — which is a data fault, surfaced as such rather than
 * papered over with a fake "Week 1 of 1".
 */
async function resolveActiveTerm(now: Date): Promise<TermContext | null> {
  const terms = await prisma.term.findMany({
    orderBy: [{ startsOn: "desc" }],
    take: 12,
    select: {
      id: true,
      code: true,
      name: true,
      startsOn: true,
      endsOn: true,
      weekCount: true,
      status: true,
    },
  });

  if (terms.length === 0) return null;

  const inProgress = terms.find((term) => term.status === "IN_PROGRESS");
  const today = calendarDateIn(now, env.timezone);
  const todayUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day),
  );

  const chosen =
    inProgress ??
    terms.find((term) => term.status === "PLANNED" && term.startsOn >= todayUtc) ??
    terms[0];

  const position = termPosition(
    { startsOn: chosen.startsOn, endsOn: chosen.endsOn, weekCount: chosen.weekCount },
    todayUtc,
  );

  return {
    id: chosen.id,
    code: chosen.code,
    name: chosen.name,
    startsOn: chosen.startsOn,
    endsOn: chosen.endsOn,
    status: chosen.status,
    weekCount: chosen.weekCount,
    week: position.week.number,
    progress: position.week.progress,
    daysRemaining: position.daysRemaining,
    isBeforeTerm: position.week.isBeforeTerm,
    isAfterTerm: position.week.isAfterTerm,
  };
}

const DEFAULT_PREFERENCES: PreferencesContext = {
  theme: "SYSTEM",
  density: "COMFORTABLE",
  weekStartsOn: 1,
  timezone: env.timezone,
  notify: {
    assignmentDue: true,
    gradePosted: true,
    announcement: true,
    messages: true,
    paymentDue: true,
  },
};

/**
 * Full shell context. One cached read of session, preferences, term and badge
 * counts. Every page that needs the sidebar or topbar awaits this.
 */
export const getShellContext = cache(async (): Promise<ShellContext | null> => {
  const session = await getSession();
  if (!session) return null;

  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 72 * 3600 * 1000);

  // Every one of these is keyed only on the session and the clock — none of them
  // needs the preferences row — so they are issued as a single wave rather than
  // two. They stay separate statements, but starting them together means they
  // overlap instead of stacking, and the round trip to the hosted database is the
  // most expensive thing this function does: the badge counts waited a full round
  // trip behind the preferences row purely because it was `await`ed after it,
  // even though nothing about the answer to one depends on the other.
  const [preferencesRow, term, unreadMessages, unreadNotifications, dueSoon] =
    await Promise.all([
      prisma.userPreference.findUnique({ where: { userId: session.user.id } }),
      resolveActiveTerm(now),
      countUnreadThreads(session.user.id),
      prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
      prisma.submission.count({
        where: {
          studentId: session.user.id,
          status: { in: ["NOT_STARTED", "DRAFT"] },
          assessment: { dueAt: { gt: now, lte: soonCutoff } },
        },
      }),
    ]);

  const preferences: PreferencesContext = preferencesRow
    ? {
        theme: preferencesRow.theme,
        density: preferencesRow.density,
        weekStartsOn: preferencesRow.weekStartsOn,
        timezone: preferencesRow.timezone,
        notify: {
          assignmentDue: preferencesRow.notifyAssignmentDue,
          gradePosted: preferencesRow.notifyGradePosted,
          announcement: preferencesRow.notifyAnnouncement,
          messages: preferencesRow.notifyMessages,
          paymentDue: preferencesRow.notifyPaymentDue,
        },
      }
    : DEFAULT_PREFERENCES;

  // The institution's timezone is the fallback; a user may override it.
  const timezone = preferences.timezone || env.timezone;

  return {
    user: session.user,
    preferences,
    timezone,
    term,
    counts: { unreadMessages, unreadNotifications, dueSoon },
    now,
  };
});

/**
 * Unread threads for a user.
 *
 * A thread is unread when a message is newer than that participant's own
 * `lastReadAt`. A NULL `lastReadAt` means never read, which must count as
 * unread — the naive `updatedAt > lastReadAt` comparison silently misses it,
 * because any NULL comparison is NULL.
 */
export async function countUnreadThreads(userId: string): Promise<number> {
  const rows = await prisma.threadParticipant.findMany({
    where: { userId, thread: { messages: { some: {} } } },
    select: {
      lastReadAt: true,
      thread: {
        select: {
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        },
      },
    },
  });

  let unread = 0;
  for (const row of rows) {
    const latest = row.thread.messages[0]?.createdAt;
    if (!latest) continue;
    if (!row.lastReadAt || latest > row.lastReadAt) unread += 1;
  }
  return unread;
}

/** Day difference from a term start, for spine positioning. */
export function termDayIndex(term: TermContext, now: Date): number {
  const today = calendarDateIn(now, env.timezone);
  return daysBetween(
    term.startsOn,
    new Date(Date.UTC(today.year, today.month - 1, today.day)),
  );
}
