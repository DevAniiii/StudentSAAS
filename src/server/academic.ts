import "server-only";

import { cache } from "react";
import { Prisma, type AssessmentKind, type EnrollmentStatus, type SubmissionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  addDays,
  atTimeInZone,
  durationLabel,
  minutesToLabel,
  mondayIndex,
  todayInZone,
} from "@/lib/dates";
import {
  percentOf,
  summarise,
  toNumber,
  workState,
  type CourseGradeSummary,
  type WorkState,
} from "@/lib/grades";

/**
 * Academic data access.
 *
 * Three rules hold throughout this file:
 *
 *  1. One query per screen, not one per component. The shapes here are
 *     deliberately denormalised for display so a page renders from a single
 *     round-trip.
 *  2. `Decimal` is converted to `number` at this boundary, so no component ever
 *     has to know Prisma exists.
 *  3. Everything is scoped by `studentId` taken from the verified session —
 *     never from a URL parameter — so there is no way to read someone else's
 *     coursework by editing a link.
 */

/* -------------------------------------------------------------------------- */
/* Enrollments                                                                */
/* -------------------------------------------------------------------------- */

export interface MeetingSlot {
  id: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  kind: string;
  room: string | null;
  /** `09:00 – 10:30`, precomputed so the view layer stays presentational. */
  timeLabel: string;
  durationLabel: string;
}

export interface SectionSummary {
  id: string;
  sectionNo: string;
  status: string;
  room: string | null;
  enrollmentStatus: EnrollmentStatus;
  course: {
    id: string;
    code: string;
    title: string;
    description: string;
    credits: number;
    level: number;
    department: string;
  };
  instructor: { id: string; name: string; email: string; title: string | null } | null;
  meetings: MeetingSlot[];
  /** Assessments graded so far / total, for the section header. */
  gradedCount: number;
  assessmentCount: number;
}

/**
 * `Prisma.validator` rather than `as const`: the shape contains a nested
 * `orderBy`, and `as const` makes those arrays readonly, which Prisma's
 * generated argument types reject.
 */
const enrollmentSelect = Prisma.validator<Prisma.EnrollmentSelect>()({
  id: true,
  status: true,
  letterGrade: true,
  gradePoints: true,
  finalPercent: true,
  creditsEarned: true,
  section: {
    select: {
      id: true,
      sectionNo: true,
      status: true,
      room: true,
      course: {
        select: {
          id: true,
          code: true,
          title: true,
          description: true,
          credits: true,
          level: true,
          department: true,
        },
      },
      instructor: {
        select: { id: true, firstName: true, lastName: true, email: true, title: true },
      },
      meetings: {
        orderBy: { startMin: "asc" },
        select: {
          id: true,
          dayOfWeek: true,
          startMin: true,
          endMin: true,
          kind: true,
          room: true,
        },
      },
    },
  },
});

export type EnrollmentRow = Awaited<ReturnType<typeof listEnrollments>>[number];

function toMeetingSlots(
  meetings: { id: string; dayOfWeek: number; startMin: number; endMin: number; kind: string; room: string | null }[],
): MeetingSlot[] {
  return meetings.map((meeting) => ({
    ...meeting,
    timeLabel: `${minutesToLabel(meeting.startMin)} – ${minutesToLabel(meeting.endMin)}`,
    durationLabel: durationLabel(meeting.startMin, meeting.endMin),
  }));
}

/** Every enrollment for a student, in the given term (or their latest term). */
export async function listEnrollments(studentId: string, termId?: string) {
  const rows = await prisma.enrollment.findMany({
    where: {
      studentId,
      status: { in: ["ENROLLED", "COMPLETED"] },
      ...(termId ? { termId } : {}),
    },
    select: enrollmentSelect,
    orderBy: { section: { course: { code: "asc" } } },
    // This select is three relations deep — section, then course and instructor
    // and meetings off it. Prisma's default strategy walks that tree one level
    // per round trip: enrollments, then sections, then courses, then instructors,
    // then meetings, five statements issued one after another. At roughly 200 ms
    // each that is a second of a timetable page spent waiting on the network for
    // rows that were already in the tables it had just queried.
    //
    // `join` asks for them as SQL joins in one statement instead. It needs the
    // relations to be to-one apart from `meetings`, which is to-many and comes
    // back nested through a lateral join — the one shape this strategy does not
    // flatten, and the reason the `orderBy` on it still has to be stated in the
    // select rather than left to the parent query.
    relationLoadStrategy: "join",
  });

  // Without a term filter, keep only the student's most recent term. Two terms'
  // worth of sections in one timetable would be actively misleading.
  //
  // This costs an extra round trip, which is why callers that already know the
  // term should pass it. A page holding the shell context can hand over the term
  // it resolved and skip the lookup entirely — see the `termId` arguments in the
  // app pages.
  if (!termId && rows.length > 0) {
    const sectionIds = rows.map((row) => row.section.id);
    const bySection = new Map(
      rows.map((row) => [row.section.id, row] as const),
    );
    const latestTermIds = await latestTermForSections(sectionIds);
    return rows.filter((row) => latestTermIds.has(row.section.id)).map((row) => bySection.get(row.section.id)!);
  }

  return rows;
}

/** Which term each of these sections belongs to, choosing the newest per course. */
async function latestTermForSections(sectionIds: string[]): Promise<Set<string>> {
  if (sectionIds.length === 0) return new Set();
  const sections = await prisma.section.findMany({
    where: { id: { in: sectionIds } },
    select: { id: true, courseId: true, term: { select: { startsOn: true } } },
  });
  const newestPerCourse = new Map<string, { id: string; startsOn: Date }>();
  for (const section of sections) {
    const existing = newestPerCourse.get(section.courseId);
    if (!existing || section.term.startsOn > existing.startsOn) {
      newestPerCourse.set(section.courseId, { id: section.id, startsOn: section.term.startsOn });
    }
  }
  return new Set([...newestPerCourse.values()].map((entry) => entry.id));
}

/** Enrollments reduced to the display shape the term timetable and cards use. */
export const getSections = cache(
  async (studentId: string, termId?: string): Promise<SectionSummary[]> => {
    const rows = await listEnrollments(studentId, termId);
    const sectionIds = rows.map((row) => row.section.id);

    // Independent of each other, so issued together. Awaited one after the other
    // these were two round trips to the hosted database in sequence, for two
    // counts that are read in the same breath a few lines below. They remain two
    // statements, but starting them together lets them overlap.
    const [counts, totals] = await Promise.all([
      prisma.assessment.groupBy({
        by: ["sectionId"],
        where: {
          sectionId: { in: sectionIds },
          submissions: { some: { studentId, score: { not: null } } },
        },
        _count: { _all: true },
      }),
      prisma.assessment.groupBy({
        by: ["sectionId"],
        where: { sectionId: { in: sectionIds } },
        _count: { _all: true },
      }),
    ]);

    const gradedMap = new Map(counts.map((row) => [row.sectionId, row._count._all]));
    const totalMap = new Map(totals.map((row) => [row.sectionId, row._count._all]));

    return rows.map((row) => ({
      id: row.section.id,
      sectionNo: row.section.sectionNo,
      status: row.section.status,
      room: row.section.room,
      enrollmentStatus: row.status,
      course: row.section.course,
      instructor: row.section.instructor
        ? {
            id: row.section.instructor.id,
            name: `${row.section.instructor.title ?? ""} ${row.section.instructor.firstName} ${row.section.instructor.lastName}`.trim(),
            email: row.section.instructor.email,
            title: row.section.instructor.title,
          }
        : null,
      meetings: toMeetingSlots(row.section.meetings),
      gradedCount: gradedMap.get(row.section.id) ?? 0,
      assessmentCount: totalMap.get(row.section.id) ?? 0,
    }));
  },
);

/* -------------------------------------------------------------------------- */
/* Today's timetable                                                           */
/* -------------------------------------------------------------------------- */

export interface ClassOccurrence {
  occurrenceId: string;
  sectionId: string;
  courseCode: string;
  courseTitle: string;
  instructorName: string | null;
  room: string | null;
  kind: string;
  /** Calendar date the class meets on. */
  date: Date;
  startsAt: Date;
  endsAt: Date;
  timeLabel: string;
  durationLabel: string;
  /** Minutes from "now" until this class starts. Negative once started. */
  minutesUntilStart: number;
  status: "upcoming" | "now" | "past";
  /** Set when the timetable entry is overridden on this date. */
  exception: {
    kind: string;
    note: string | null;
    room: string | null;
    timeLabel: string | null;
  } | null;
}

/**
 * The classes that meet today, in order, with their date-specific exceptions
 * applied and their start/end resolved to real instants in the institution's
 * timezone.
 *
 * Exceptions are merged here rather than in the view so a cancelled lab is
 * simply absent from the list, and a relocated one carries its new room — which
 * is the only version of the truth worth showing a student.
 */
export const getTodayClasses = cache(
  async (
    studentId: string,
    timezone: string,
    now: Date,
  ): Promise<ClassOccurrence[]> => {
    const rows = await listEnrollments(studentId);
    if (rows.length === 0) return [];

    const sectionIds = rows.map((row) => row.section.id);
    const today = todayInZone(now, timezone);
    const weekday = mondayIndex(now, timezone);

    const exceptions = await prisma.meetingException.findMany({
      where: { sectionId: { in: sectionIds }, date: today },
      select: {
        meetingId: true,
        sectionId: true,
        kind: true,
        note: true,
        room: true,
        startMin: true,
        endMin: true,
      },
    });
    const exceptionByMeeting = new Map(exceptions.map((exception) => [exception.meetingId, exception]));

    const occurrences: ClassOccurrence[] = [];

    for (const row of rows) {
      const section = row.section;
      for (const meeting of section.meetings) {
        // A meeting whose weekday does not match today simply does not occur.
        if (meeting.dayOfWeek !== weekday) continue;

        const exception = exceptionByMeeting.get(meeting.id);
        if (exception?.kind === "CANCELLED") continue;

        const startMin = exception?.startMin ?? meeting.startMin;
        const endMin = exception?.endMin ?? meeting.endMin;
        const startsAt = atTimeInZone(today, startMin, timezone);
        const endsAt = atTimeInZone(today, endMin, timezone);
        const minutesUntilStart = Math.round((startsAt.getTime() - now.getTime()) / 60_000);

        occurrences.push({
          occurrenceId: meeting.id,
          sectionId: section.id,
          courseCode: section.course.code,
          courseTitle: section.course.title,
          instructorName: section.instructor
            ? `${section.instructor.title ?? ""} ${section.instructor.firstName} ${section.instructor.lastName}`.trim()
            : null,
          room: exception?.room ?? meeting.room ?? section.room,
          kind: meeting.kind,
          date: today,
          startsAt,
          endsAt,
          timeLabel: `${minutesToLabel(startMin)} – ${minutesToLabel(endMin)}`,
          durationLabel: durationLabel(startMin, endMin),
          minutesUntilStart,
          status: now >= startsAt ? (now < endsAt ? "now" : "past") : "upcoming",
          exception: exception
            ? {
                kind: exception.kind,
                note: exception.note,
                room: exception.room,
                timeLabel:
                  exception.startMin !== null && exception.endMin !== null
                    ? `${minutesToLabel(exception.startMin)} – ${minutesToLabel(exception.endMin)}`
                    : null,
              }
            : null,
        });
      }
    }

    return occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  },
);

/* -------------------------------------------------------------------------- */
/* Schedule disruptions                                                        */
/* -------------------------------------------------------------------------- */

export interface Disruption {
  id: string;
  date: Date;
  kind: string;
  note: string | null;
  courseCode: string;
  courseTitle: string;
  /** `14:00 – 15:30`, or null when the slot is unchanged. */
  timeLabel: string | null;
  room: string | null;
  /** Days from today; negative for past disruptions. */
  daysAway: number;
}

/** Upcoming cancellations, relocations and reschedules across all sections. */
export const getDisruptions = cache(
  async (studentId: string, now: Date, horizonDays = 21): Promise<Disruption[]> => {
    const rows = await listEnrollments(studentId);
    if (rows.length === 0) return [];

    const today = todayInZone(now, "UTC");
    const horizon = addDays(today, horizonDays);

    const exceptions = await prisma.meetingException.findMany({
      where: {
        sectionId: { in: rows.map((row) => row.section.id) },
        date: { gte: today, lte: horizon },
      },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        kind: true,
        note: true,
        room: true,
        startMin: true,
        endMin: true,
        section: {
          select: { course: { select: { code: true, title: true } } },
        },
      },
    });

    return exceptions.map((exception) => ({
      id: exception.id,
      date: exception.date,
      kind: exception.kind,
      note: exception.note,
      courseCode: exception.section.course.code,
      courseTitle: exception.section.course.title,
      timeLabel:
        exception.startMin !== null && exception.endMin !== null
          ? `${minutesToLabel(exception.startMin)} – ${minutesToLabel(exception.endMin)}`
          : null,
      room: exception.room,
      daysAway: Math.round((exception.date.getTime() - today.getTime()) / 86_400_000),
    }));
  },
);

/* -------------------------------------------------------------------------- */
/* Assessments                                                                 */
/* -------------------------------------------------------------------------- */

export interface AssessmentRow {
  id: string;
  title: string;
  brief: string | null;
  kind: AssessmentKind;
  weightPercent: number;
  maxScore: number;
  dueAt: Date | null;
  releasedAt: Date | null;
  sectionId: string;
  courseCode: string;
  courseTitle: string;
  instructorName: string | null;
  state: WorkState;
  submission: {
    id: string;
    status: SubmissionStatus;
    score: number | null;
    feedback: string | null;
    submittedAt: Date | null;
    gradedAt: Date | null;
    attempt: number;
    percent: number | null;
  } | null;
  /** Negative days until the deadline, positive once past. */
  daysUntilDue: number | null;
  hoursUntilDue: number | null;
}

export type AssessmentFilter =
  | "open"
  | "submitted"
  | "graded"
  | "overdue"
  | "all";

/**
 * Every assessment on the student's sections, with the student's own
 * submission attached.
 *
 * One query with a nested `submission` filtered to the current student, rather
 * than a query per assessment — with six courses and a dozen items each, the
 * N+1 version would be ~80 round-trips on the single most-visited screen.
 */
export const getAssessments = cache(
  async (studentId: string, now: Date, filter: AssessmentFilter = "open"): Promise<AssessmentRow[]> => {
    const rows = await listEnrollments(studentId);
    if (rows.length === 0) return [];

    const sectionById = new Map(rows.map((row) => [row.section.id, row.section]));

    const assessments = await prisma.assessment.findMany({
      where: { sectionId: { in: [...sectionById.keys()] } },
      orderBy: [{ dueAt: "asc" }, { position: "asc" }],
      select: {
        id: true,
        title: true,
        brief: true,
        kind: true,
        weightPercent: true,
        maxScore: true,
        dueAt: true,
        releasedAt: true,
        sectionId: true,
        submissions: {
          where: { studentId },
          take: 1,
          select: {
            id: true,
            status: true,
            score: true,
            feedback: true,
            submittedAt: true,
            gradedAt: true,
            attempt: true,
          },
        },
      },
    });

    const mapped: AssessmentRow[] = assessments.map((assessment) => {
      const section = sectionById.get(assessment.sectionId)!;
      const submission = assessment.submissions[0] ?? null;
      const maxScore = toNumber(assessment.maxScore) ?? 100;
      const score = submission ? toNumber(submission.score) : null;
      const state = submission
        ? workState({ status: submission.status, dueAt: assessment.dueAt, now })
        : workState({ status: "NOT_STARTED", dueAt: assessment.dueAt, now });

      return {
        id: assessment.id,
        title: assessment.title,
        brief: assessment.brief,
        kind: assessment.kind,
        weightPercent: toNumber(assessment.weightPercent) ?? 0,
        maxScore,
        dueAt: assessment.dueAt,
        releasedAt: assessment.releasedAt,
        sectionId: assessment.sectionId,
        courseCode: section.course.code,
        courseTitle: section.course.title,
        instructorName: section.instructor
          ? `${section.instructor.title ?? ""} ${section.instructor.firstName} ${section.instructor.lastName}`.trim()
          : null,
        state,
        submission: submission
          ? {
              id: submission.id,
              status: submission.status,
              score,
              feedback: submission.feedback,
              submittedAt: submission.submittedAt,
              gradedAt: submission.gradedAt,
              attempt: submission.attempt,
              percent: percentOf(score, maxScore),
            }
          : null,
        daysUntilDue: assessment.dueAt
          ? Math.floor((assessment.dueAt.getTime() - now.getTime()) / 86_400_000)
          : null,
        hoursUntilDue: assessment.dueAt
          ? Math.floor((assessment.dueAt.getTime() - now.getTime()) / 3600_000)
          : null,
      };
    });

    return applyAssessmentFilter(mapped, filter);
  },
);

function applyAssessmentFilter(rows: AssessmentRow[], filter: AssessmentFilter): AssessmentRow[] {
  switch (filter) {
    case "open":
      return rows.filter(
        (row) => row.state === "NOT_STARTED" || row.state === "DRAFT" || row.state === "OVERDUE",
      );
    case "overdue":
      return rows.filter((row) => row.state === "OVERDUE");
    case "submitted":
      return rows.filter((row) => row.state === "SUBMITTED" || row.state === "LATE");
    case "graded":
      return rows.filter((row) => row.state === "GRADED" || row.state === "RETURNED");
    case "all":
      return rows;
    default:
      return rows;
  }
}

/* -------------------------------------------------------------------------- */
/* Grades                                                                      */
/* -------------------------------------------------------------------------- */

export interface CourseGrade extends SectionSummary {
  summary: CourseGradeSummary;
  items: {
    id: string;
    title: string;
    kind: AssessmentKind;
    weightPercent: number;
    score: number | null;
    maxScore: number;
    percent: number | null;
    gradedAt: Date | null;
    feedback: string | null;
    state: WorkState;
  }[];
  /** Grade recorded against the enrollment once the term closed. */
  final: {
    letterGrade: string | null;
    gradePoints: number | null;
    finalPercent: number | null;
    creditsEarned: number | null;
  } | null;
}

export const getCourseGrades = cache(
  async (studentId: string, now: Date): Promise<CourseGrade[]> => {
    const rows = await listEnrollments(studentId);
    if (rows.length === 0) return [];

    const sectionIds = rows.map((row) => row.section.id);

    const assessments = await prisma.assessment.findMany({
      where: { sectionId: { in: sectionIds } },
      orderBy: [{ position: "asc" }, { dueAt: "asc" }],
      select: {
        id: true,
        sectionId: true,
        title: true,
        kind: true,
        weightPercent: true,
        maxScore: true,
        dueAt: true,
        submissions: {
          where: { studentId },
          take: 1,
          select: { score: true, feedback: true, gradedAt: true, status: true },
        },
      },
    });

    const sections = await getSections(studentId);
    const sectionById = new Map(sections.map((section) => [section.id, section]));

    return rows.map((row) => {
      const section = sectionById.get(row.section.id)!;
      const items = assessments
        .filter((assessment) => assessment.sectionId === row.section.id)
        .map((assessment) => {
          const submission = assessment.submissions[0] ?? null;
          const maxScore = toNumber(assessment.maxScore) ?? 100;
          const score = submission ? toNumber(submission.score) : null;
          return {
            id: assessment.id,
            title: assessment.title,
            kind: assessment.kind,
            weightPercent: toNumber(assessment.weightPercent) ?? 0,
            score,
            maxScore,
            percent: percentOf(score, maxScore),
            gradedAt: submission?.gradedAt ?? null,
            feedback: submission?.feedback ?? null,
            state: workState({
              status: submission?.status ?? "NOT_STARTED",
              dueAt: assessment.dueAt,
              now,
            }),
          };
        });

      return {
        ...section,
        items,
        // `summarise` works on the weighted shape; `items` is the display shape.
        // They are mapped rather than unified so the grade table can keep
        // `score`/`percent`/`feedback` without the maths caring about them.
        summary: summarise(
          items.map((item) => ({
            weightPercent: item.weightPercent,
            earnedPercent: item.percent,
            score: item.score,
            maxScore: item.maxScore,
          })),
        ),
        final: {
          letterGrade: row.letterGrade,
          gradePoints: toNumber(row.gradePoints),
          finalPercent: toNumber(row.finalPercent),
          creditsEarned: toNumber(row.creditsEarned),
        },
      };
    });
  },
);

export interface Standing {
  cumulativeGpa: number | null;
  creditsAttempted: number | null;
  creditsEarned: number | null;
  standing: string | null;
  generatedAt: Date | null;
  /** Term credits in progress, shown separately from the sealed record. */
  inProgressCredits: number;
  inProgressPoints: number;
}

export const getStanding = cache(async (studentId: string): Promise<Standing> => {
  const [transcript, enrollments] = await Promise.all([
    prisma.transcript.findUnique({ where: { studentId } }),
    listEnrollments(studentId),
  ]);

  let inProgressPoints = 0;
  let inProgressCredits = 0;
  for (const row of enrollments) {
    const points = toNumber(row.gradePoints);
    if (points === null) continue;
    inProgressPoints += points * row.section.course.credits;
    inProgressCredits += row.section.course.credits;
  }

  return {
    cumulativeGpa: toNumber(transcript?.cumulativeGpa),
    creditsAttempted: toNumber(transcript?.creditsAttempted),
    creditsEarned: toNumber(transcript?.creditsEarned),
    standing: transcript?.standing ?? null,
    generatedAt: transcript?.generatedAt ?? null,
    inProgressCredits,
    inProgressPoints,
  };
});

/* -------------------------------------------------------------------------- */
/* Course detail                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One section, verified against the student's own enrollment.
 *
 * The enrollment lookup is the authorisation: if there is no enrollment row for
 * this student and section, the resource does not exist *for them*, and we throw
 * 404 rather than 403 so the existence of another student's section is not
 * disclosed.
 */
export async function getSectionForStudent(studentId: string, sectionId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_sectionId: { studentId, sectionId } },
    select: enrollmentSelect,
  });
  if (!enrollment || enrollment.status === "DROPPED") return null;
  return enrollment;
}
