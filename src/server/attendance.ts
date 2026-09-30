import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/db";
import { addDays, todayInZone } from "@/lib/dates";
import {
  addMark,
  buildHeatStrip,
  emptyTally,
  judgeAttendance,
  type AttendanceMark,
  type AttendanceTally,
  type AttendanceVerdict,
  type HeatDay,
} from "@/lib/attendance";

/**
 * Attendance data access.
 *
 * The register is the source of truth and it lives in `attendance_records`, but
 * almost every question a student asks is about a *course over a term*, not
 * about individual marks. So this module aggregates once per section and
 * derives every view from that — rather than letting each component re-query
 * and re-count.
 */

export interface CourseAttendance {
  sectionId: string;
  courseCode: string;
  courseTitle: string;
  instructorName: string | null;
  tally: AttendanceTally;
  rate: number | null;
  verdict: AttendanceVerdict;
  /** Marks in reverse chronological order, for the course-level list. */
  recent: {
    date: Date;
    status: AttendanceMark;
    note: string | null;
    courseCode: string;
  }[];
}

export interface AttendanceOverview {
  courses: CourseAttendance[];
  total: AttendanceTally;
  rate: number | null;
  verdict: AttendanceVerdict;
  /** One entry per calendar date across the term, for the heat strip. */
  heat: HeatDay[];
  /** Unclosed registers: sessions that exist with no mark yet. */
  unmarkedCount: number;
  /** Terms of marks available, oldest first. */
  courseCount: number;
}

/**
 * Attendance for every enrolled course in the current term.
 *
 * One `findMany` over the joins, aggregated in JS. The alternative — a
 * `groupBy` per status per course plus a second query per course for the recent
 * list — is six round-trips per section, and this screen has six sections.
 */
export const getAttendanceOverview = cache(
  async (studentId: string, now: Date): Promise<AttendanceOverview> => {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        studentId,
        status: { in: ["ENROLLED", "COMPLETED"] },
      },
      select: {
        section: {
          select: {
            id: true,
            course: { select: { code: true, title: true } },
            instructor: { select: { firstName: true, lastName: true, title: true } },
            meetings: { select: { dayOfWeek: true } },
          },
        },
      },
    });

    if (enrollments.length === 0) {
      return {
        courses: [],
        total: emptyTally(),
        rate: null,
        verdict: judgeAttendance(emptyTally(), now, { meetingsRemaining: 0, examDate: null }),
        heat: [],
        unmarkedCount: 0,
        courseCount: 0,
      };
    }

    const sectionIds = enrollments.map((row) => row.section.id);
    const sectionMeta = new Map(enrollments.map((row) => [row.section.id, row.section]));

    const records = await prisma.attendanceRecord.findMany({
      where: { studentId, session: { sectionId: { in: sectionIds } } },
      orderBy: [{ markedAt: "desc" }],
      select: {
        status: true,
        note: true,
        session: {
          select: {
            date: true,
            sectionId: true,
            closedAt: true,
            section: { select: { course: { select: { code: true } } } },
          },
        },
      },
    });

    // Sessions that exist but were never closed have no records; that is the
    // definition of "unmarked", and it is different from "absent".
    const openSessions = await prisma.attendanceSession.count({
      where: { sectionId: { in: sectionIds }, closedAt: null },
    });

    const total = emptyTally();
    const heatRows: { date: Date; status: AttendanceMark; courseCode: string }[] = [];
    const perSection = new Map<string, AttendanceTally>();
    const recentBySection = new Map<
      string,
      { date: Date; status: AttendanceMark; note: string | null; courseCode: string }[]
    >();

    for (const sectionId of sectionIds) {
      perSection.set(sectionId, emptyTally());
      recentBySection.set(sectionId, []);
    }

    for (const record of records) {
      const mark = record.status as AttendanceMark;
      const code = record.session.section.course.code;

      addMark(total, mark);
      const sectionTally = perSection.get(record.session.sectionId);
      if (sectionTally) addMark(sectionTally, mark);

      heatRows.push({ date: record.session.date, status: mark, courseCode: code });

      const recent = recentBySection.get(record.session.sectionId);
      if (recent && recent.length < 40) {
        recent.push({ date: record.session.date, status: mark, note: record.note, courseCode: code });
      }
    }

    const today = todayInZone(now, "UTC");

    const courses: CourseAttendance[] = enrollments.map(({ section }) => {
      const tally = perSection.get(section.id) ?? emptyTally();
      const meetingDays = new Set(section.meetings.map((meeting) => meeting.dayOfWeek));

      // How many times this course still meets: count forward from today to the
      // end of a 16-week horizon, in the section's own meeting weekdays.
      const meetingsRemaining = countOccurrences(today, meetingDays, 16 * 7);

      const verdict = judgeAttendance(tally, now, { meetingsRemaining, examDate: null });

      return {
        sectionId: section.id,
        courseCode: section.course.code,
        courseTitle: section.course.title,
        instructorName: section.instructor
          ? `${section.instructor.title ?? ""} ${section.instructor.firstName} ${section.instructor.lastName}`.trim()
          : null,
        tally,
        rate: verdict.rate,
        verdict,
        recent: recentBySection.get(section.id) ?? [],
      };
    });

    courses.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));

    return {
      courses,
      total,
      rate: judgeAttendance(total, now, { meetingsRemaining: 0, examDate: null }).rate,
      verdict: judgeAttendance(total, now, {
        meetingsRemaining: courses.reduce((sum, course) => {
          const meetingDays = new Set(
            sectionMeta.get(course.sectionId)?.meetings.map((m) => m.dayOfWeek) ?? [],
          );
          return sum + countOccurrences(today, meetingDays, 16 * 7);
        }, 0),
        examDate: null,
      }),
      heat: buildHeatStrip(heatRows),
      unmarkedCount: openSessions,
      courseCount: courses.length,
    };
  },
);

/**
 * How many of the given weekdays fall in the next `horizonDays` days, inclusive
 * of today.
 */
function countOccurrences(from: Date, weekdays: ReadonlySet<number>, horizonDays: number): number {
  if (weekdays.size === 0) return 0;
  let count = 0;
  for (let offset = 0; offset <= horizonDays; offset++) {
    const day = addDays(from, offset);
    // `Meeting.dayOfWeek` is 0 = Monday; Date#getUTCDay is 0 = Sunday.
    if (weekdays.has((day.getUTCDay() + 6) % 7)) count += 1;
  }
  return count;
}
