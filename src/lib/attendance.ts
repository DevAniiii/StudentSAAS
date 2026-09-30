import { round1 } from "./grades";

/**
 * Attendance policy.
 *
 * Configured as constants rather than magic numbers scattered through
 * components, because these thresholds are policy: a student is told "you are
 * at risk" because of a published rule, and that rule should be readable in one
 * place and changed in one place.
 */

/** Minimum attendance to sit an exam. Standard institutional figure. */
export const EXAM_ELIGIBILITY_FLOOR = 0.75;

/** Below this, a course is flagged for intervention. */
export const INTERVENTION_FLOOR = 0.8;

export type AttendanceMark = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" | "UNMARKED";

export interface AttendanceTally {
  present: number;
  late: number;
  absent: number;
  excused: number;
  unmarked: number;
  /** Meetings held so far. */
  held: number;
}

export function emptyTally(): AttendanceTally {
  return { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0, held: 0 };
}

export function addMark(tally: AttendanceTally, status: AttendanceMark): AttendanceTally {
  if (status === "UNMARKED") {
    tally.unmarked += 1;
    return tally;
  }
  tally[status.toLowerCase() as "present" | "late" | "absent" | "excused"] += 1;
  tally.held += 1;
  return tally;
}

/**
 * Attendance rate.
 *
 * LATE counts as half. An excused absence is excluded from the denominator
 * entirely rather than counted as present — a student with a documented medical
 * exemption has not "attended", and pretending otherwise would let them bank
 * credit. Unmarked sessions are excluded too: the register was never closed, so
 * it is not evidence of absence.
 */
export function attendanceRate(tally: AttendanceTally): number | null {
  const denominator = tally.present + tally.late + tally.absent;
  if (denominator === 0) return null;
  return round1(((tally.present + tally.late * 0.5) / denominator) * 100);
}

export type AttendanceRisk = "good" | "watch" | "at-risk" | "blocked";

export interface AttendanceVerdict {
  rate: number | null;
  risk: AttendanceRisk;
  /** Whole classes the student can still miss before hitting the floor. */
  classesRemaining: number | null;
  /** Whole classes that would push them under the floor. */
  missesBeforeBreach: number | null;
  headline: string;
}

/**
 * Project an attendance record against the exam-eligibility rule.
 *
 * `missesBeforeBreach` is computed by simulation rather than by dividing,
 * because the arithmetic does not round the way people expect: at 80% over 10
 * classes, three more absences is the answer, not two.
 */
export function judgeAttendance(
  tally: AttendanceTally,
  now: Date,
  options: { meetingsRemaining: number; examDate: Date | null },
): AttendanceVerdict {
  const rate = attendanceRate(tally);
  const counted = tally.present + tally.late + tally.absent;

  if (rate === null) {
    return {
      rate: null,
      risk: "good",
      classesRemaining: null,
      missesBeforeBreach: null,
      headline: "No register has been closed yet.",
    };
  }

  // Fractional credit a LATE contributes, kept in half-units so the simulation
  // matches the displayed rate exactly.
  const creditUnits = tally.present * 2 + tally.late; // 2 units = one full class
  const classesRemaining = options.meetingsRemaining;

  let missesBeforeBreach: number | null = null;
  for (let misses = 0; misses <= classesRemaining; misses++) {
    const units = creditUnits;
    const total = counted + misses;
    const nextRate = total === 0 ? 1 : units / (total * 2);
    if (nextRate < EXAM_ELIGIBILITY_FLOOR) {
      missesBeforeBreach = misses;
      break;
    }
  }

  // Whole classes that can still be missed and stay at or above the floor.
  let classesRemainingWithinFloor: number | null = null;
  for (let misses = 0; misses <= classesRemaining; misses++) {
    const total = counted + misses;
    const nextRate = total === 0 ? 1 : creditUnits / (total * 2);
    if (nextRate >= EXAM_ELIGIBILITY_FLOOR) {
      classesRemainingWithinFloor = misses;
    } else {
      break;
    }
  }

  const floorPercent = EXAM_ELIGIBILITY_FLOOR * 100;
  const isBreached = rate < floorPercent;
  const isWatch = rate < INTERVENTION_FLOOR * 100;

  const risk: AttendanceRisk = isBreached
    ? "blocked"
    : isWatch
      ? "at-risk"
      : classesRemainingWithinFloor !== null && classesRemainingWithinFloor <= 2
        ? "watch"
        : "good";

  let headline: string;
  if (isBreached) {
    headline = `Below the ${floorPercent.toFixed(0)}% exam-eligibility floor. Speak to your instructor about a makeup.`;
  } else if (missesBeforeBreach !== null && missesBeforeBreach <= 2) {
    const plural = missesBeforeBreach === 1 ? "one more absence" : `${missesBeforeBreach} more absences`;
    headline = `${plural} puts you under the ${floorPercent.toFixed(0)}% floor for the exam.`;
  } else if (isWatch) {
    headline = `Under the ${(INTERVENTION_FLOOR * 100).toFixed(0)}% intervention threshold. Worth a conversation.`;
  } else if (options.meetingsRemaining === 0) {
    headline = "Attendance is recorded and above the eligibility floor.";
  } else {
    headline = `${classesRemainingWithinFloor ?? 0} absences left before the ${floorPercent.toFixed(0)}% floor.`;
  }

  return {
    rate,
    risk,
    classesRemaining: classesRemainingWithinFloor,
    missesBeforeBreach,
    headline,
  };
}

/**
 * Collapse a term's marks into one day per calendar date.
 *
 * A student has several classes a day, so a "day" on the heat strip is the
 * worst outcome of that date, not the sum of them. Showing `ABSENT, PRESENT,
 * PRESENT` as "absent" is the honest reading.
 */
export interface HeatDay {
  dateKey: string;
  status: AttendanceMark;
  /** How many classes were held that date. */
  count: number;
  /** Course codes involved, for the tooltip. */
  courseCodes: string[];
}

const SEVERITY: Record<AttendanceMark, number> = {
  ABSENT: 4,
  UNMARKED: 3,
  LATE: 2,
  EXCUSED: 1,
  PRESENT: 0,
};

export function buildHeatStrip(
  rows: readonly {
    date: Date;
    status: AttendanceMark;
    courseCode: string;
  }[],
): HeatDay[] {
  const byDay = new Map<string, HeatDay>();

  for (const row of rows) {
    const key = row.date.toISOString().slice(0, 10);
    const existing = byDay.get(key);

    if (!existing) {
      byDay.set(key, { dateKey: key, status: row.status, count: 1, courseCodes: [row.courseCode] });
      continue;
    }

    existing.count += 1;
    if (!existing.courseCodes.includes(row.courseCode)) existing.courseCodes.push(row.courseCode);
    // Keep the most consequential mark of the day.
    if (SEVERITY[row.status] > SEVERITY[existing.status]) existing.status = row.status;
  }

  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}
