import { cn } from "@/lib/cn";
import { Badge, CourseChip, type Tone } from "@/components/ui/badge";
import { formatPercent, type LetterGrade, type WorkState } from "@/lib/grades";
import { formatMoney, INSTITUTION_CURRENCY, type Cents } from "@/lib/money";
import type { AttendanceRisk } from "@/lib/attendance";

/**
 * Vocabulary shared across pages.
 *
 * Status is a *label*, not a colour. Every one of these returns text, because
 * "ochre pill" is not something a screen reader can read and "Overdue" is. The
 * tone is there to make the label scannable, never to replace it.
 *
 * One table per vocabulary rather than a generic `<Status>` with a tone
 * parameter: these are the exact sets the database can produce, and a
 * `Record<WorkState, …>` makes an unhandled state a compile error rather than a
 * blank pill discovered in production.
 */

const WORK_STATE: Record<WorkState, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: "Not started", tone: "neutral" },
  DRAFT: { label: "In progress", tone: "info" },
  SUBMITTED: { label: "Submitted", tone: "good" },
  LATE: { label: "Submitted late", tone: "warn" },
  GRADED: { label: "Graded", tone: "good" },
  RETURNED: { label: "Returned", tone: "info" },
  OVERDUE: { label: "Overdue", tone: "danger" },
};

export function WorkBadge({
  state,
  className,
}: {
  state: WorkState;
  className?: string;
}) {
  const entry = WORK_STATE[state] ?? WORK_STATE.NOT_STARTED;
  return (
    <Badge tone={entry.tone} className={className}>
      {entry.label}
    </Badge>
  );
}

const ASSESSMENT_KIND: Record<string, string> = {
  ASSIGNMENT: "Assignment",
  QUIZ: "Quiz",
  LAB: "Lab",
  PROJECT: "Project",
  ESSAY: "Essay",
  EXAM: "Exam",
  PRESENTATION: "Presentation",
  PARTICIPATION: "Participation",
  MIDTERM: "Midterm",
  FINAL: "Final",
  QUIZZES: "Quizzes",
};

export function kindLabel(kind: string): string {
  return (
    ASSESSMENT_KIND[kind] ??
    kind
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^./, (character) => character.toUpperCase())
  );
}

const ATTENDANCE_RISK: Record<AttendanceRisk, { label: string; tone: Tone }> = {
  good: { label: "On track", tone: "good" },
  watch: { label: "Watch", tone: "warn" },
  "at-risk": { label: "At risk", tone: "warn" },
  blocked: { label: "Below eligibility", tone: "danger" },
};

export function riskBadge(risk: AttendanceRisk, className?: string) {
  const entry = ATTENDANCE_RISK[risk] ?? ATTENDANCE_RISK.good;
  return (
    <Badge tone={entry.tone} className={className}>
      {entry.label}
    </Badge>
  );
}

const SETTLEMENT: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  OPEN: { label: "Outstanding", tone: "warn" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  SETTLED: { label: "Paid", tone: "good" },
  VOID: { label: "Void", tone: "neutral" },
};

export function settlementBadge(settlement: string, className?: string) {
  const entry = SETTLEMENT[settlement] ?? SETTLEMENT.DRAFT;
  return (
    <Badge tone={entry.tone} className={className}>
      {entry.label}
    </Badge>
  );
}

/**
 * A percentage that is always paired with what it is a percentage of.
 *
 * `86%` alone is meaningless — 86% of what? The component takes the label from
 * the caller so the same number is never rendered without its denominator.
 */
export function Percent({
  value,
  of,
  className,
  tone,
}: {
  value: number | null;
  /** The denominator, e.g. "of work graded". */
  of?: string;
  className?: string;
  tone?: Tone;
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger-hover"
      : tone === "warn"
        ? "text-ochre-hover"
        : tone === "good"
          ? "text-accent"
          : "text-ink";

  return (
    <span className={cn("font-mono tabular-nums", toneClass, className)}>
      {formatPercent(value)}
      {of ? <span className="ml-1 font-sans text-ink-subtle">{of}</span> : null}
    </span>
  );
}

export function Money({
  cents,
  currency = INSTITUTION_CURRENCY,
  className,
  sign = false,
}: {
  cents: Cents;
  currency?: string;
  className?: string;
  /** Prefix a `+` for a credit. */
  sign?: boolean;
}) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {sign && cents > 0 ? "+" : ""}
      {formatMoney(cents, currency)}
    </span>
  );
}

/** A course code with its title, the pair used in nearly every list row. */
export function CourseLine({
  code,
  title,
  className,
  link,
}: {
  code: string;
  title: string;
  className?: string;
  link?: React.ReactNode;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <CourseChip code={code} />
      <span className="min-w-0 truncate text-sm text-ink">{title}</span>
      {link}
    </span>
  );
}

/** Grade letter as text. Used where a stamp would be too loud. */
export function LetterChip({ letter }: { letter: LetterGrade | null }) {
  if (!letter) {
    return <span className="font-mono text-ink-subtle">—</span>;
  }
  return (
    <span className="font-mono font-medium tracking-tight text-ink">{letter}</span>
  );
}
