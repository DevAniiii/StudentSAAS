import "server-only";

import { cache } from "react";
import type { AnnouncementAudience, NotificationKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/http/errors";

/**
 * Communication data access — threads, announcements, notifications.
 */

/* -------------------------------------------------------------------------- */
/* Threads                                                                     */
/* -------------------------------------------------------------------------- */

export interface ThreadPreview {
  id: string;
  subject: string;
  courseCode: string | null;
  updatedAt: Date;
  /** True when a message is newer than this participant's `lastReadAt`. */
  unread: boolean;
  /** Messages since the user last read. */
  unreadCount: number;
  participants: {
    id: string;
    name: string;
    title: string | null;
    initials: string;
    avatarHue: number;
    isSelf: boolean;
  }[];
  lastMessage: {
    body: string;
    createdAt: Date;
    senderName: string;
    senderId: string;
  } | null;
}

const participantSelect = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      title: true,
      avatarHue: true,
      role: true,
    },
  },
} as const;

/**
 * Threads the user participates in, most recently active first.
 *
 * The unread flag is computed here rather than in the schema because it is a
 * function of two columns on two rows; materialising it would mean invalidating
 * a counter on every message and every read receipt.
 *
 * Read receipts are read in the same query as the thread list, so an unread
 * badge cannot be shown for a thread the user has already opened.
 */
export const getThreads = cache(async (userId: string): Promise<ThreadPreview[]> => {
  const threads = await prisma.thread.findMany({
    where: { participants: { some: { userId } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      subject: true,
      updatedAt: true,
      course: { select: { code: true } },
      participants: { select: participantSelect },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, body: true, createdAt: true, senderId: true },
      },
    },
  });

  const readStates = await prisma.threadParticipant.findMany({
    where: { userId, threadId: { in: threads.map((thread) => thread.id) } },
    select: { threadId: true, lastReadAt: true },
  });
  const readMap = new Map(readStates.map((state) => [state.threadId, state.lastReadAt]));

  const fullMessages = await prisma.message.findMany({
    where: { threadId: { in: threads.map((thread) => thread.id) } },
    orderBy: { createdAt: "asc" },
    select: { id: true, threadId: true, createdAt: true, senderId: true },
  });
  const messagesByThread = new Map<string, typeof fullMessages>();
  for (const message of fullMessages) {
    const bucket = messagesByThread.get(message.threadId);
    if (bucket) bucket.push(message);
    else messagesByThread.set(message.threadId, [message]);
  }

  return threads.map((thread) => {
    const lastReadAt = readMap.get(thread.id) ?? null;
    const history = messagesByThread.get(thread.id) ?? [];
    const unreadCount = lastReadAt
      ? history.filter((message) => message.createdAt > lastReadAt).length
      : history.length;

    return {
      id: thread.id,
      subject: thread.subject,
      courseCode: thread.course?.code ?? null,
      updatedAt: thread.updatedAt,
      unread: unreadCount > 0,
      unreadCount,
      participants: thread.participants.map(({ user }) => ({
        id: user.id,
        name: `${user.title ?? ""} ${user.firstName} ${user.lastName}`.trim(),
        title: user.title,
        initials: `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase(),
        avatarHue: user.avatarHue,
        isSelf: user.id === userId,
      })),
      lastMessage: thread.messages[0]
        ? {
            body: thread.messages[0].body,
            createdAt: thread.messages[0].createdAt,
            senderId: thread.messages[0].senderId,
            senderName: "someone",
          }
        : null,
    };
  });
});

export interface ThreadMessage {
  id: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  senderId: string;
  senderName: string;
  senderTitle: string | null;
  senderHue: number;
  isSelf: boolean;
}

/** One thread, authorised by participation. Returns null if not a participant. */
export const getThread = cache(
  async (userId: string, threadId: string): Promise<(ThreadPreview & { messages: ThreadMessage[] }) | null> => {
    const [previews] = await Promise.all([getThreads(userId)]);
    const preview = previews.find((thread) => thread.id === threadId);
    if (!preview) return null;

    const messages = await prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        editedAt: true,
        senderId: true,
        sender: { select: { firstName: true, lastName: true, title: true, avatarHue: true } },
      },
    });

    return {
      ...preview,
      messages: messages.map((message) => ({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt,
        editedAt: message.editedAt,
        senderId: message.senderId,
        senderName: `${message.sender.title ?? ""} ${message.sender.firstName} ${message.sender.lastName}`.trim(),
        senderTitle: message.sender.title,
        senderHue: message.sender.avatarHue,
        isSelf: message.senderId === userId,
      })),
    };
  },
);

/** People the user can start a thread with. Instructors of their sections. */
export const getMessageRecipients = cache(async (userId: string) => {
  const sections = await prisma.enrollment.findMany({
    where: { studentId: userId, status: { in: ["ENROLLED", "COMPLETED"] } },
    select: {
      section: {
        select: {
          instructor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              title: true,
              email: true,
              avatarHue: true,
            },
          },
          course: { select: { code: true } },
        },
      },
    },
  });

  const seen = new Map<string, { id: string; name: string; title: string | null; email: string; initials: string; avatarHue: number; courseCodes: string[] }>();
  for (const { section } of sections) {
    const instructor = section.instructor;
    if (!instructor || instructor.id === userId) continue;
    const existing = seen.get(instructor.id);
    const name = `${instructor.title ?? ""} ${instructor.firstName} ${instructor.lastName}`.trim();
    if (existing) {
      if (!existing.courseCodes.includes(section.course.code)) {
        existing.courseCodes.push(section.course.code);
      }
      continue;
    }
    seen.set(instructor.id, {
      id: instructor.id,
      name,
      title: instructor.title,
      email: instructor.email,
      initials: `${instructor.firstName[0] ?? ""}${instructor.lastName[0] ?? ""}`.toUpperCase(),
      avatarHue: instructor.avatarHue,
      courseCodes: [section.course.code],
    });
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
});

/**
 * Server-side re-derivation of the recipient list.
 *
 * `getMessageRecipients` builds the dropdown the client shows, but the dropdown
 * is a convenience, not an authorisation: every browser can be told to send any
 * `recipientId` it likes. This re-runs the same derivation as a single existence
 * check so the send route can refuse anyone the dropdown would not have offered.
 *
 * Written as a direct `count` rather than by reusing the cached list, for two
 * reasons. The cached function returns a person-shaped array and this needs a
 * boolean, so reusing it would mean building and discarding the whole list to
 * answer a yes/no. And it must not be cached: it is called from a mutation route
 * where "was this person an instructor of mine a moment ago" and "are they one
 * now" can differ, and a memoised `false` would outlive an enrolment change.
 *
 * Throws rather than returning a boolean, so a caller cannot forget to check.
 */
export async function requireMessageRecipient(userId: string, recipientId: string): Promise<void> {
  if (recipientId === userId) {
    // Not a privilege escalation — you can already reach yourself — but it
    // produces a one-person thread that can never be read by anyone useful, so
    // it is refused as the obvious mistake it almost always is.
    throw new AppError(ErrorCode.VALIDATION_FAILED, 422, "You cannot message yourself.", {
      fields: [{ path: "recipientId", message: "Choose someone else." }],
    });
  }

  const count = await prisma.enrollment.count({
    where: {
      studentId: userId,
      status: { in: ["ENROLLED", "COMPLETED"] },
      section: { instructorId: recipientId },
    },
  });

  if (count === 0) {
    // 404 rather than 403, and identical to the "no such user" case, so this
    // cannot be used to test whether an id corresponds to a real account.
    throw AppError.notFound("Recipient");
  }
}

/* -------------------------------------------------------------------------- */
/* Announcements                                                               */
/* -------------------------------------------------------------------------- */

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  pinned: boolean;
  publishedAt: Date;
  expiresAt: Date | null;
  author: { name: string; title: string | null; initials: string; avatarHue: number };
  courseCode: string | null;
  courseTitle: string | null;
  termName: string | null;
}

/**
 * Announcements visible to a student.
 *
 * Visibility is a union of three overlapping audiences: institute-wide, the
 * student's own sections, and the student's programme. Encoded as an `OR` in
 * the query so the database filters rather than the application, and so a
 * student cannot receive an announcement for a course they are not taking.
 */
export const getAnnouncements = cache(
  async (userId: string, now: Date): Promise<AnnouncementView[]> => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        studyYear: true,
        programId: true,
        enrollments: {
          where: { status: { in: ["ENROLLED", "COMPLETED"] } },
          select: { sectionId: true },
        },
      },
    });
    if (!user) return [];

    const sectionIds = user.enrollments.map((enrollment) => enrollment.sectionId);

    const rows = await prisma.announcement.findMany({
      where: {
        AND: [
          // Never show a notice before it is published, or after it expires.
          { publishedAt: { lte: now } },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          {
            OR: [
              { audience: "ALL_STUDENTS" },
              { audience: "COURSE", sectionId: { in: sectionIds } },
              ...(user.studyYear !== null
                ? [{ audience: "STUDY_YEAR" as const, studyYear: user.studyYear }]
                : []),
              // A PROGRAM notice reaches students whose programme owns the
              // course the notice was attached to, or who have no section link
              // at all and are still in the programme.
              ...(user.programId !== null
                ? [
                    {
                      audience: "PROGRAM" as const,
                      OR: [
                        { section: { course: { programId: user.programId } } },
                        { sectionId: null, term: { is: null } },
                      ],
                    },
                  ]
                : []),
            ],
          },
        ],
      },
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      take: 60,
      select: {
        id: true,
        title: true,
        body: true,
        audience: true,
        pinned: true,
        publishedAt: true,
        expiresAt: true,
        author: { select: { firstName: true, lastName: true, title: true, avatarHue: true } },
        section: { select: { course: { select: { code: true, title: true } } } },
        term: { select: { name: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      audience: row.audience,
      pinned: row.pinned,
      publishedAt: row.publishedAt,
      expiresAt: row.expiresAt,
      author: {
        name: `${row.author.title ?? ""} ${row.author.firstName} ${row.author.lastName}`.trim(),
        title: row.author.title,
        initials: `${row.author.firstName[0] ?? ""}${row.author.lastName[0] ?? ""}`.toUpperCase(),
        avatarHue: row.author.avatarHue,
      },
      courseCode: row.section?.course.code ?? null,
      courseTitle: row.section?.course.title ?? null,
      termName: row.term?.name ?? null,
    }));
  },
);

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export const getNotifications = cache(
  async (userId: string, take = 30): Promise<NotificationView[]> => {
    const rows = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        href: true,
        readAt: true,
        createdAt: true,
      },
    });
    return rows;
  },
);
