import { cn } from "@/lib/cn";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { Code } from "@/components/ui/badge";
import { Meter } from "@/components/ui/data-display";
import {
  EXAM_ELIGIBILITY_FLOOR,
  INTERVENTION_FLOOR,
  type AttendanceMark,
  type HeatDay,
} from "@/lib/attendance";
import { formatDayMonth, formatFullDate, formatRelativeDay } from "@/lib/dates";
import type { AttendanceOverview, CourseAttendance } from "@/server/attendance";
import { riskBadge } from "./vocabulary";

/**
 * The attendance board.
 *
 * Ordered by urgency, top to bottom:
 *
 *  1. **The verdict.** One rate, one headline sentence, and the two thresholds
 *     drawn on the meter as ticks so the number has a position, not just a value.
 *  2. **The term heat strip.** Every date, so a run of absences reads as a shape.
 *  3. **Per course, worst first.** Each with its own "you can miss N more" line.
 *
 * Worst-first is the opposite of alphabetical, and deliberately so. A student
 * opening this page is looking for the course that is going to cost them
 * something; making them scan six cards to find it would make the page useless
 * at the moment it is most needed. `getAttendanceOverview` already sorts this
 * way.
 */

/* -------------------------------------------------------------------------- */
/* Verdict                                                                    */
/* -------------------------------------------------------------------------- */

const MARK_COPY: Record<AttendanceMark, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  EXCUSED: "Excused absence",
  UNMARKED: "Not yet marked",
};

const MARK_TONE: Record<AttendanceMark, string> = {
  PRESENT: "text-accent",
  LATE: "text-ochre-hover",
  ABSENT: "text-danger-hover",
  EXCUSED: "text-info",
  UNMARKED: "text-ink-subtle",
};

function VerdictPanel({
  overview,
  rate,
}: {
  overview: AttendanceOverview;
  rate: number | null;
}) {
  const { total, verdict, unmarkedCount } = overview;

  return (
    <Panel as="section" aria-labelledby="verdict">
      <PanelHeader
        id="verdict"
        title="Where you stand"
        description={`${total.held} class${total.held === 1 ? "" : "es"} recorded this term`}
      />

      <div className="grid gap-x-6 gap-y-5 px-4 py-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <div>
          <p className="font-mono text-4xl font-medium leading-none tracking-[-0.03em] tabular-nums text-ink">
            {rate === null ? "—" : `${Math.round(rate)}%`}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">{verdict.headline}</p>
          <div className="mt-2.5">
            {riskBadge(verdict.risk)}
          </div>
        </div>

        <div className="min-w-0">
          {/* The meter with both thresholds drawn on it. A single number with a
              75% rule somewhere in the legend is a number you have to do
              subtraction against; a tick on the track is not. */}
          <div className="relative">
            <Meter
              value={rate ?? 0}
              size="md"
              tone={
                verdict.risk === "blocked" || verdict.risk === "at-risk"
                  ? "danger"
                  : verdict.risk === "watch"
                    ? "warn"
                    : "primary"
              }
              label={`${rate === null ? "No attendance recorded" : `${Math.round(rate)} per cent attendance`}`}
            />
            <Tick
              at={INTERVENTION_FLOOR * 100}
              label="80% intervention"
              tone="warn"
            />
            <Tick
              at={EXAM_ELIGIBILITY_FLOOR * 100}
              label="75% exam eligibility"
              tone="danger"
            />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Tally label="Present" value={total.present} tone="good" />
            <Tally label="Late" value={total.late} tone="warn" />
            <Tally label="Absent" value={total.absent} tone="danger" />
            <Tally
              label="Excused"
              value={total.excused}
              tone="info"
              hint="Not counted against you"
            />
          </dl>

          {unmarkedCount > 0 ? (
            <p className="mt-4 rounded-sm bg-well px-3 py-2 text-2xs leading-relaxed text-ink-muted">
              <span className="font-mono text-ink-subtle">{unmarkedCount}</span> session
              {unmarkedCount === 1 ? " has" : "s have"} been held but not yet marked. Those do not
              count against your rate — an unmarked register is the department&apos;s gap, not an
              absence. They will appear here once marked.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/**
 * A threshold marker drawn on the meter track.
 *
 * The mark itself is `aria-hidden` and a 1px line, because it conveys nothing to
 * a screen reader on its own — the rate above it is already announced, along with
 * the two thresholds in the page copy. What the mark adds is *position*: seeing
 * where 80% sits relative to where you are is the whole reason it exists, and
 * that is a visual fact.
 *
 * `label` is therefore not decoration. The mark is a 1px line but its *hit area*
 * is 16px wide, so the threshold has a name at the point of use rather than only
 * in the page copy above — a student hovering the number they are trying to
 * interpret gets "80% intervention" instead of a bare line.
 */
function Tick({
  at,
  label,
  tone,
}: {
  at: number;
  label: string;
  tone: "warn" | "danger";
}) {
  return (
    <span
      aria-hidden
      title={label}
      // The wrapper is 16px wide and offset back 8px, so the 1px rule inside it
      // lands exactly on `at` while the hover target is a usable size.
      className="absolute top-0 h-full w-4 -translate-x-1/2"
      style={{ left: `${at}%` }}
    >
      <span
        className={cn(
          "absolute left-1/2 top-0 h-full w-px -translate-x-1/2",
          tone === "danger" ? "bg-danger/60" : "bg-ochre/60",
        )}
      />
    </span>
  );
}

function Tally({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "danger" | "info";
  hint?: string;
}) {
  return (
    <div>
      <dt className="font-mono text-2xs uppercase tracking-[0.12em] text-ink-subtle">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 font-mono text-lg font-medium leading-none tabular-nums",
          value === 0
            ? "text-ink-subtle"
            : tone === "good"
              ? "text-accent"
              : tone === "warn"
                ? "text-ochre-hover"
                : tone === "danger"
                  ? "text-danger-hover"
                  : "text-info",
        )}
      >
        {value}
      </dd>
      {hint ? <p className="mt-1 text-2xs leading-snug text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Heat strip                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The term, as a strip of days.
 *
 * One cell per calendar date that has at least one class in it, filled by the
 * *worst* mark on that day — a student who was present for a lecture and absent
 * from the lab was absent that day, and showing anything else would be a lie by
 * aggregation.
 *
 * The cells are real buttons, not a canvas: each opens a popover-free
 * `title`-bearing detail via `aria-label`, so a screen reader can read the whole
 * term if it wants to, and the strip stays keyboard-navigable. `tabIndex={-1}`
 * on the individual cells is deliberate — a 70-stop tab trap on a visualisation
 * is worse than not offering it, because the same information is in the course
 * tables directly below.
 */
function HeatStrip({ heat }: { heat: HeatDay[] }) {
  if (heat.length === 0) {
    return (
      <p className="px-4 py-4 text-xs text-ink-muted">
        No classes have been held yet this term.
      </p>
    );
  }

  return (
    <div className="px-4 py-4">
      <ol className="flex flex-wrap gap-[3px]" role="list">
        {heat.map((day) => {
          const label = describeDay(day);
          return (
            <li key={day.dateKey}>
              <span
                role="img"
                aria-label={label}
                tabIndex={-1}
                title={label}
                className={cn(
                  "block size-3 rounded-[2px] ring-1 ring-inset",
                  cellTone(day.status),
                )}
              />
            </li>
          );
        })}
      </ol>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {(["PRESENT", "LATE", "ABSENT", "EXCUSED", "UNMARKED"] as const).map((mark) => (
          <span key={mark} className="flex items-center gap-1.5 text-2xs text-ink-muted">
            <span aria-hidden className={cn("size-2.5 rounded-[2px] ring-1 ring-inset", cellTone(mark))} />
            {MARK_COPY[mark]}
          </span>
        ))}
      </div>
    </div>
  );
}

function cellTone(mark: AttendanceMark): string {
  switch (mark) {
    case "PRESENT":
      return "bg-accent-subtle ring-accent/25";
    case "LATE":
      return "bg-ochre/55 ring-ochre/40";
    case "ABSENT":
      return "bg-danger ring-danger/50";
    case "EXCUSED":
      return "bg-info-subtle ring-info/40";
    case "UNMARKED":
      return "bg-transparent ring-rule-strong ring-dashed";
  }
}

function describeDay(day: HeatDay): string {
  const mark = MARK_COPY[day.status].toLowerCase();
  const courses = day.courseCodes.join(", ");
  return `${formatFullDate(new Date(`${day.dateKey}T00:00:00Z`))}: ${mark}${
    day.count > 1 ? ` (${day.count} classes)` : ""
  } — ${courses}`;
}

/* -------------------------------------------------------------------------- */
/* Per course                                                                 */
/* -------------------------------------------------------------------------- */

export function AttendanceBoard({
  overview,
  rate,
  timezone,
  now,
}: {
  overview: AttendanceOverview;
  rate: number | null;
  timezone: string;
  now: Date;
}) {
  if (overview.courses.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No attendance recorded"
          description="You have no course enrolments with a published register. Marks appear here once your instructors begin recording attendance."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <VerdictPanel overview={overview} rate={rate} />

      <Panel as="section" aria-labelledby="heat">
        <PanelHeader
          id="heat"
          title="This term, day by day"
          description="One cell per date with a class. A date shows the worst mark recorded that day."
        />
        <HeatStrip heat={overview.heat} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {overview.courses.map((course) => (
          <CourseCard key={course.sectionId} course={course} timezone={timezone} now={now} />
        ))}
      </div>
    </div>
  );
}

function CourseCard({
  course,
  timezone,
  now,
}: {
  course: CourseAttendance;
  timezone: string;
  now: Date;
}) {
  const { tally, verdict, rate } = course;
  const breach = verdict.missesBeforeBreach;
  const remaining = verdict.classesRemaining;

  return (
    <Panel as="article" aria-labelledby={`att-${course.sectionId}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <Code>{course.courseCode}</Code>
          <h3
            id={`att-${course.sectionId}`}
            className="mt-1 truncate text-sm font-semibold text-ink"
          >
            {course.courseTitle}
          </h3>
          <p className="mt-0.5 truncate text-2xs text-ink-muted">
            {course.instructorName ?? "Instructor not recorded"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className={cn(
              "font-mono text-lg font-medium leading-none tabular-nums",
              rate === null
                ? "text-ink-subtle"
                : verdict.risk === "blocked" || verdict.risk === "at-risk"
                  ? "text-danger-hover"
                  : verdict.risk === "watch"
                    ? "text-ochre-hover"
                    : "text-accent",
            )}
          >
            {rate === null ? "—" : `${Math.round(rate)}%`}
          </span>
          {riskBadge(verdict.risk)}
        </div>
      </div>

      {/* The actionable line. "You can miss two more" is the sentence a student
          actually came for; the rate above is the supporting evidence. */}
      <div className="border-b border-rule px-4 py-3">
        {remaining !== null && remaining <= 2 ? (
          <p
            className={cn(
              "text-xs font-medium leading-relaxed",
              remaining === 0 ? "text-danger-hover" : "text-ochre-hover",
            )}
          >
            {remaining === 0
              ? "You are at the limit. The next absence in this course drops you below the exam threshold."
              : `You can miss ${remaining === 1 ? "one more class" : `${remaining} more classes`} before you fall below 75%.`}
          </p>
        ) : remaining !== null ? (
          <p className="text-xs leading-relaxed text-ink-muted">
            Room for {remaining} more absences in this course.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-ink-muted">{verdict.headline}</p>
        )}

        <div className="mt-2.5">
          <Meter
            value={rate ?? 0}
            size="sm"
            tone={
              verdict.risk === "blocked" || verdict.risk === "at-risk"
                ? "danger"
                : verdict.risk === "watch"
                  ? "warn"
                  : "primary"
            }
            label={`${course.courseCode}: ${rate === null ? "no marks" : `${Math.round(rate)} per cent`}`}
          />
        </div>

        {breach !== null && breach <= 3 ? (
          <p className="mt-2 text-2xs leading-relaxed text-ink-subtle">
            {breach === 0
              ? "No further absences can be recorded against this course."
              : `${breach} absence${breach === 1 ? "" : "s"} from losing exam eligibility.`}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-4 divide-x divide-rule border-b border-rule">
        <Mini label="Present" value={tally.present} />
        <Mini label="Late" value={tally.late} />
        <Mini label="Absent" value={tally.absent} tone="danger" />
        <Mini label="Excused" value={tally.excused} />
      </div>

      {course.recent.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-medium text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
            <span className="group-open:hidden">Show the register</span>
            <span className="hidden group-open:inline">Hide the register</span>
            <span className="ml-1.5 font-mono text-2xs text-ink-subtle">
              {course.recent.length} entries
            </span>
            {/*
              How stale is the register? A rate computed from a register whose
              last entry was three weeks ago looks identical to a current one on
              this card, and the student cannot tell that the number is about to
              move. The date is the newest entry — `recent` is reverse
              chronological, which the server guarantees.
            */}
            <span className="ml-1.5 font-mono text-2xs text-ink-subtle">
              · last marked {formatRelativeDay(course.recent[0].date, now, timezone).toLowerCase()}
            </span>
          </summary>
          <ul className="max-h-72 divide-y divide-rule overflow-y-auto border-t border-rule">
            {course.recent.map((entry) => (
              <li
                key={`${entry.courseCode}-${entry.date.toISOString()}-${entry.status}`}
                className="flex items-baseline gap-3 px-4 py-2"
              >
                <time
                  dateTime={entry.date.toISOString()}
                  className="shrink-0 font-mono text-2xs tabular-nums text-ink-subtle"
                >
                  {formatDayMonth(entry.date, timezone)}
                </time>
                <span className={cn("shrink-0 text-2xs font-medium", MARK_TONE[entry.status])}>
                  {MARK_COPY[entry.status]}
                </span>
                {entry.note ? (
                  <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted">
                    {entry.note}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="px-4 py-3 text-xs text-ink-muted">
          No register entries for this course yet.
        </p>
      )}
    </Panel>
  );
}

function Mini({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className="px-3 py-2.5 text-center">
      <p
        className={cn(
          "font-mono text-sm font-medium leading-none tabular-nums",
          value === 0
            ? "text-ink-subtle"
            : tone === "danger"
              ? "text-danger-hover"
              : "text-ink",
        )}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-[0.55rem] uppercase tracking-[0.1em] text-ink-subtle">
        {label}
      </p>
    </div>
  );
}

