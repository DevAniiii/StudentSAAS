/**
 * Grade computation.
 *
 * Everything here is pure and takes plain numbers. Prisma returns `Decimal`
 * objects for weighted columns, and mixing those into arithmetic in a component
 * is how a transcript ends up printing `NaN`. So: convert at the query
 * boundary with `toNumber`, compute here, render elsewhere.
 */

/** Institution's grading scale. Stored on the transcript, not hard-coded twice. */
export const GRADE_SCALE = [
  { letter: "A+", points: 4.0, minPercent: 97 },
  { letter: "A", points: 4.0, minPercent: 93 },
  { letter: "A-", points: 3.7, minPercent: 90 },
  { letter: "B+", points: 3.3, minPercent: 87 },
  { letter: "B", points: 3.0, minPercent: 83 },
  { letter: "B-", points: 2.7, minPercent: 80 },
  { letter: "C+", points: 2.3, minPercent: 77 },
  { letter: "C", points: 2.0, minPercent: 73 },
  { letter: "C-", points: 1.7, minPercent: 70 },
  { letter: "D", points: 1.0, minPercent: 60 },
  { letter: "F", points: 0.0, minPercent: 0 },
] as const;

export type LetterGrade = (typeof GRADE_SCALE)[number]["letter"];

/** Percent → letter. Clamped, so 1000% is an A rather than a crash. */
export function letterFor(percent: number): LetterGrade {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return GRADE_SCALE.find((band) => clamped >= band.minPercent)?.letter ?? "F";
}

/** Percent → grade points. */
export function pointsFor(percent: number): number {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return GRADE_SCALE.find((band) => clamped >= band.minPercent)?.points ?? 0;
}

/** Grade points → letter, for rendering a stored outcome. */
export function letterForPoints(points: number): LetterGrade {
  return GRADE_SCALE.find((band) => band.points === points)?.letter ?? "F";
}

/** Lowest letter that still counts as passing. */
export const PASS_LETTER: LetterGrade = "D";

export function isPassing(percent: number): boolean {
  return percent >= 60;
}

/* -------------------------------------------------------------------------- */
/* Course grade                                                               */
/* -------------------------------------------------------------------------- */

export interface WeightedItem {
  /** Contribution to the final grade, as a percentage (e.g. 12 for a 12% exam). */
  weightPercent: number;
  /** Percentage earned on this item, or null when it has not been graded. */
  earnedPercent: number | null;
  /** Raw score, retained for display next to the percentage. */
  score: number | null;
  maxScore: number;
}

export interface CourseGradeSummary {
  /** 0-100, from graded items only. Null while nothing is graded. */
  currentPercent: number | null;
  /** Letter implied by `currentPercent`. */
  projectedLetter: LetterGrade | null;
  /** Sum of weights of items already graded, 0-100. */
  gradedWeight: number;
  /** Sum of all weights, 0-100. */
  totalWeight: number;
  /** Weight still outstanding, 0-100. */
  outstandingWeight: number;
  /** True when the weights do not add to 100 — a real data fault, surfaced not hidden. */
  weightsAreSuspect: boolean;
  /** Grade still reachable, i.e. earning full marks on everything outstanding. */
  maximumAchievablePercent: number;
  /** Grade guaranteed no matter what happens next. */
  minimumGuaranteedPercent: number;
  /** A grade above this requires excellence on work not yet done. */
  atRiskLetter: LetterGrade | null;
}

/**
 * Weighted course grade from graded items only.
 *
 * Deliberately *not* divided by total weight: dividing by 100 at week 6 with
 * half the term ungraded reports a grade that is mostly a statement about the
 * calendar. The honest number at that point is "84% of the work graded so far,
 * carrying 68% of the final mark" — which is exactly what this returns.
 *
 * `maximumAchievablePercent` and `minimumGuaranteedPercent` are what make a
 * projection actionable: they answer "what do I still have to do to hold an A?"
 * without pretending the current number is final.
 */
export function summarise(items: readonly WeightedItem[]): CourseGradeSummary {
  const totalWeight = items.reduce((sum, item) => sum + item.weightPercent, 0);
  const graded = items.filter((item) => item.earnedPercent !== null);

  const gradedWeight = graded.reduce((sum, item) => sum + item.weightPercent, 0);
  const outstandingWeight = round1(totalWeight - gradedWeight);

  const currentPercent =
    graded.length === 0 || gradedWeight === 0
      ? null
      : round1(
          graded.reduce((sum, item) => sum + (item.earnedPercent ?? 0) * item.weightPercent, 0) /
            gradedWeight,
        );

  // Everything still outstanding could still be earned in full…
  let maximumAchievable = 0;
  // …or all of it could score zero. Both bounds ignore credit-bearing effects,
  // which only ever narrow the range, so they stay honest as bounds.
  for (const item of items) {
    const earned = item.earnedPercent ?? 100;
    maximumAchievable += earned * item.weightPercent;
  }
  let minimumGuaranteed = 0;
  for (const item of items) {
    const earned = item.earnedPercent ?? 0;
    minimumGuaranteed += earned * item.weightPercent;
  }

  const projectedLetter = currentPercent === null ? null : letterFor(currentPercent);

  // The next letter up: what has to be held on to. A flat A+ needs nothing.
  const nextBand =
    projectedLetter === null
      ? GRADE_SCALE[0]
      : GRADE_SCALE.find(
          (band) => band.letter === projectedLetter && band.minPercent < 100,
        );
  const atRiskLetter =
    nextBand && maximumAchievable >= nextBand.minPercent ? nextBand.letter : null;

  return {
    currentPercent,
    projectedLetter,
    gradedWeight: round1(gradedWeight),
    totalWeight: round1(totalWeight),
    outstandingWeight,
    // A 1-percentage-point rounding gap is normal after trimming; a large one
    // is a configuration error the registrar needs to see.
    weightsAreSuspect: Math.abs(totalWeight - 100) > 1,
    maximumAchievablePercent: round1(maximumAchievable),
    minimumGuaranteedPercent: round1(minimumGuaranteed),
    atRiskLetter,
  };
}

/* -------------------------------------------------------------------------- */
/* Cumulative GPA                                                             */
/* -------------------------------------------------------------------------- */

export interface GpaInput {
  gradePoints: number;
  credits: number;
}

/**
 * Cumulative GPA, credits-weighted.
 *
 * A pass/fail course must not enter the calculation at all — including its
 * credits in the denominator is the classic way a GPA silently drops. Callers
 * filter those out and pass only graded, credit-bearing work.
 */
export function cumulativeGpa(entries: readonly GpaInput[]): number {
  const attempted = entries.reduce((sum, entry) => sum + entry.credits, 0);
  if (attempted <= 0) return 0;
  const quality = entries.reduce(
    (sum, entry) => sum + entry.gradePoints * entry.credits,
    0,
  );
  return round3(quality / attempted);
}

/** Standing bands, keyed off cumulative GPA. */
export function standingFor(gpa: number): { label: string; tone: "good" | "warn" | "risk" } {
  if (gpa >= 3.5) return { label: "Dean’s list standing", tone: "good" };
  if (gpa >= 2.0) return { label: "Good standing", tone: "good" };
  if (gpa >= 1.0) return { label: "Academic warning", tone: "warn" };
  return { label: "Probation — registrar contact required", tone: "risk" };
}

/* -------------------------------------------------------------------------- */
/* Rounding                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Round to a fixed number of decimals without the float surprises of
 * `Math.round(x * 100) / 100` on values like 1.005.
 */
export function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  // The epsilon nudge corrects representations like 76.44999999999999.
  return Math.round((value + Number.EPSILON * Math.sign(value) * Math.abs(value)) * factor) / factor;
}

export const round1 = (value: number) => round(value, 1);
export const round2 = (value: number) => round(value, 2);
export const round3 = (value: number) => round(value, 3);

/**
 * Prisma `Decimal` (and `null`) to a plain number.
 *
 * Every query boundary in this app runs its selects through this, so no
 * component ever sees a `Decimal` instance.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  // Prisma.Decimal and anything else numeric-ish.
  const candidate = value as { toString(): string };
  if (typeof candidate.toString === "function") {
    const parsed = Number(candidate.toString());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Percentage earned on an assessment, from raw and maximum scores. */
export function percentOf(score: number | null, maxScore: number): number | null {
  if (score === null || maxScore <= 0) return null;
  return round1((score / maxScore) * 100);
}

/**
 * Submission state → whether it still needs work.
 * Drives the "what should I do next" filters, so it must be total.
 */
export type WorkState =
  | "NOT_STARTED"
  | "DRAFT"
  | "SUBMITTED"
  | "LATE"
  | "GRADED"
  | "RETURNED"
  | "OVERDUE";

export function workState(input: {
  status: string;
  dueAt: Date | null;
  now: Date;
}): WorkState {
  if (input.dueAt && input.dueAt.getTime() < input.now.getTime()) {
    // Graded and returned work is history, not an outstanding obligation.
    if (input.status === "GRADED" || input.status === "SUBMITTED") {
      return input.status === "GRADED" ? "GRADED" : "OVERDUE";
    }
    return "OVERDUE";
  }
  return input.status as WorkState;
}

/** `86.4%` — one decimal, trailing `.0` removed so 90 reads as `90%`. */
export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  const rounded = round1(value);
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/** GPA to two decimals, as a transcript prints it. */
export function formatGpa(value: number): string {
  return value.toFixed(2);
}
