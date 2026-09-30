import { cn } from "@/lib/cn";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { Meter } from "@/components/ui/data-display";
import { Badge } from "@/components/ui/badge";
import { formatRelativeDay, formatTime } from "@/lib/dates";
import { formatMoney, type Cents } from "@/lib/money";
import type { AssessmentRow, ClassOccurrence } from "@/server/academic";
import { WorkBadge, kindLabel, CourseLine } from "./vocabulary";

/**
 * Today's timetable.
 *
 * The screen's primary object, so it is built around one judgement: *what should
 * I be doing right now?* Time is the organising axis, not course — a student
 * with three classes today does not think in courses, they think in hours. So:
 *
 *  - the current class is marked by a rule and a fill, not by being moved to the
 *    top, because moving it would break the chronological reading
 *  - a class in progress shows elapsed and remaining, which is the number a
 *    student actually wants mid-lecture
 *  - a class that has ended stays visible but recedes, so the morning's shape is
 *    still legible — a list that drops what is over is a list that changes length
 *    every few hours and makes the page feel unstable
 */

const STATUS_MARK: Record<ClassOccurrence["status"], string> = {
  now: "In progress",
  upcoming: "",
  past: "",
};

export function TodaySchedule({
  occurrences,
  now,
  timezone,
  todayLabel,
}: {
  occurrences: ClassOccurrence[];
  now: Date;
  timezone: string;
  /** Secondary line under the title. Omitted entirely when there is nothing to say. */
  todayLabel?: string;
}) {
  return (
    <Panel as="section" aria-labelledby="today-schedule">
      <PanelHeader
        id="today-schedule"
        title="Today"
        description={todayLabel}
        leading={
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-sm border border-rule bg-well"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-ink-muted">
              <rect x="2" y="3.25" width="12" height="10.5" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M2 6.4h12M5.4 1.9v2.6M10.6 1.9v2.6"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </span>
        }
      />

      {occurrences.length === 0 ? (
        <EmptyState
          compact
          title="Nothing scheduled today"
          description="No classes meet on this date. The term timetable is on the Term page."
        />
      ) : (
        <ol className="divide-y divide-rule">
          {occurrences.map((occurrence) => (
            <ClassRow
              key={occurrence.occurrenceId}
              occurrence={occurrence}
              now={now}
              timezone={timezone}
            />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function ClassRow({
  occurrence,
  now,
  timezone,
}: {
  occurrence: ClassOccurrence;
  now: Date;
  timezone: string;
}) {
  const inProgress = occurrence.status === "now";
  const past = occurrence.status === "past";

  // Minutes of the meeting already elapsed, and minutes left in it.
  const totalMinutes = (occurrence.endsAt.getTime() - occurrence.startsAt.getTime()) / 60_000;
  const elapsed =
    inProgress
      ? Math.min(Math.max((now.getTime() - occurrence.startsAt.getTime()) / 60_000, 0), totalMinutes)
      : past
        ? totalMinutes
        : 0;
  const progress = totalMinutes > 0 ? (elapsed / totalMinutes) * 100 : 0;

  return (
    <li
      className={cn(
        "relative px-4 py-3 transition-colors duration-base",
        inProgress && "bg-accent-subtle/30",
        past && "opacity-65",
      )}
    >
      {/* The live marker. A left rule rather than a colour change, so the
          in-progress class is identifiable in greyscale. */}
      {inProgress ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-accent"
        />
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            inProgress ? "font-semibold text-accent" : "text-ink-muted",
          )}
        >
          {occurrence.timeLabel}
        </span>
        <CourseLine
          code={occurrence.courseCode}
          title={occurrence.courseTitle}
          className="min-w-0 flex-1 basis-40"
        />
        {inProgress ? (
          <Badge tone="good" dot>
            {STATUS_MARK.now}
          </Badge>
        ) : null}
        {occurrence.exception ? (
          <Badge tone="warn">
            {occurrence.exception.kind === "RELOCATED" ? "Relocated" : "Rescheduled"}
          </Badge>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-muted">
        {occurrence.room ? <span>{occurrence.room}</span> : null}
        <span className="font-mono tabular-nums">{occurrence.durationLabel}</span>
        {occurrence.instructorName ? <span>{occurrence.instructorName}</span> : null}
        {occurrence.exception?.room ? (
          <span className="text-ochre-hover">Room changed to {occurrence.exception.room}</span>
        ) : null}
        {occurrence.exception?.note ? <span>{occurrence.exception.note}</span> : null}
      </div>

      {inProgress ? (
        <div className="mt-2">
          <Meter
            value={progress}
            label={`${occurrence.courseCode} in progress, ${Math.round(progress)} per cent elapsed`}
            size="sm"
          />
          <p className="mt-1.5 text-2xs text-ink-muted">
            {Math.round(elapsed)} min in · {Math.round(totalMinutes - elapsed)} min left · ends{" "}
            <time dateTime={occurrence.endsAt.toISOString()}>
              {formatTime(occurrence.endsAt, timezone)}
            </time>
          </p>
        </div>
      ) : occurrence.status === "upcoming" ? (
        <p className="mt-1.5 text-2xs text-ink-subtle">
          {formatRelativeDay(occurrence.startsAt, now, timezone)} ·{" "}
          {occurrence.minutesUntilStart < 60
            ? `in ${occurrence.minutesUntilStart} min`
            : `in ${Math.round(occurrence.minutesUntilStart / 60)} h`}
        </p>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Outstanding work                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What still has to be done, nearest deadline first.
 *
 * Overdue work is sorted to the top of the list and separated by a rule, because
 * the ordering that matters here is not "soonest" but "already late, then
 * soonest". A pure date sort buries an item three days overdue under six items
 * due next week, which is the wrong priority for a student who is behind.
 */
export function OutstandingWork({
  items,
  now,
  timezone,
}: {
  items: AssessmentRow[];
  now: Date;
  timezone: string;
}) {
  const overdue = items.filter((item) => item.state === "OVERDUE");
  const upcoming = items.filter((item) => item.state !== "OVERDUE");

  return (
    <Panel as="section" aria-labelledby="outstanding">
      <PanelHeader
        id="outstanding"
        title="Outstanding work"
        description={
          items.length === 0
            ? undefined
            : `${items.length} item${items.length === 1 ? "" : "s"}`
        }
        actions={
          <a
            href="/assignments"
            className="text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            All work
          </a>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          compact
          title="Nothing outstanding"
          description="Every assessment on your sections has been submitted or graded."
        />
      ) : (
        <div>
          {overdue.length > 0 ? (
            <>
              <p className="border-b border-rule bg-danger-subtle px-4 py-1.5 font-mono text-2xs uppercase tracking-[0.13em] text-danger-hover">
                Overdue · {overdue.length}
              </p>
              <ul className="divide-y divide-rule">
                {overdue.map((item) => (
                  <WorkRow key={item.id} item={item} now={now} timezone={timezone} />
                ))}
              </ul>
            </>
          ) : null}

          {upcoming.length > 0 ? (
            <ul className="divide-y divide-rule">
              {upcoming.map((item) => (
                <WorkRow key={item.id} item={item} now={now} timezone={timezone} />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function WorkRow({
  item,
  now,
  timezone,
}: {
  item: AssessmentRow;
  now: Date;
  timezone: string;
}) {
  const due = item.dueAt;
  const urgent = item.hoursUntilDue !== null && item.hoursUntilDue <= 48;

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3">
      <div className="min-w-0 flex-1 basis-52">
        <CourseLine code={item.courseCode} title={item.title} />
        <p className="mt-0.5 pl-1 text-2xs text-ink-muted">
          {kindLabel(item.kind)} · {item.weightPercent}% of final mark
        </p>
      </div>

      <div className="text-right">
        <WorkBadge state={item.state} />
        {due ? (
          <p
            className={cn(
              "mt-1 font-mono text-2xs tabular-nums",
              urgent ? "text-ochre-hover" : "text-ink-subtle",
            )}
          >
            <time dateTime={due.toISOString()}>
              {formatRelativeDay(due, now, timezone)} · {formatTime(due, timezone)}
            </time>
          </p>
        ) : (
          <p className="mt-1 font-mono text-2xs text-ink-subtle">No deadline</p>
        )}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick glance                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The four numbers a student checks first, in a fixed order.
 *
 * Order is by *urgency*, not by category, and the order does not change per
 * course mix: attendance can be worse than fees and vice versa, so a stable order
 * is what makes this scannable. Each figure links to the page that explains it,
 * because a number without its workings is a worry rather than a fact.
 */
export function GlanceStrip({
  standing,
  attendanceRate,
  outstandingCount,
  outstandingWeight,
  balanceCents,
  currency,
}: {
  standing: { cumulativeGpa: number | null; creditsEarned: number | null } | null;
  attendanceRate: number | null;
  outstandingCount: number;
  outstandingWeight: number;
  balanceCents: Cents;
  currency: string;
}) {
  const attendanceTone =
    attendanceRate === null
      ? "text-ink"
      : attendanceRate >= 90
        ? "text-accent"
        : attendanceRate >= 80
          ? "text-ochre-hover"
          : "text-danger-hover";

  return (
    <Panel as="section" aria-label="At a glance" className="overflow-hidden">
      <dl className="grid grid-cols-2 divide-rule lg:grid-cols-4 lg:divide-x">
        <Glance
          href="/grades"
          label="Cumulative GPA"
          value={standing?.cumulativeGpa !== null && standing?.cumulativeGpa !== undefined
            ? standing.cumulativeGpa.toFixed(2)
            : "—"}
          hint={
            standing?.creditsEarned != null
              ? `${standing.creditsEarned} credits earned`
              : "No sealed transcript yet"
          }
        />
        <Glance
          href="/attendance"
          label="Attendance"
          value={attendanceRate === null ? "—" : `${Math.round(attendanceRate)}%`}
          hint="Across all courses"
          tone={attendanceTone}
        />
        <Glance
          href="/assignments"
          label="Outstanding"
          value={String(outstandingCount)}
          hint={
            outstandingWeight > 0
              ? `${outstandingWeight}% of the final mark`
              : "Nothing to submit"
          }
          tone={outstandingCount > 0 ? "text-ochre-hover" : "text-ink"}
        />
        <Glance
          href="/finance"
          label="Balance due"
          value={formatMoney(balanceCents, currency)}
          hint={balanceCents > 0 ? "Outstanding across invoices" : "Nothing outstanding"}
          tone={balanceCents > 0 ? "text-danger-hover" : "text-accent"}
          last
        />
      </dl>
    </Panel>
  );
}

function Glance({
  href,
  label,
  value,
  hint,
  tone = "text-ink",
  last = false,
}: {
  href: string;
  label: string;
  value: string;
  hint: string;
  tone?: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-b border-rule px-4 py-3.5 transition-colors duration-fast hover:bg-hover lg:border-b-0",
        last && "lg:border-b-0",
      )}
    >
      <dt className="font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">{label}</dt>
      <dd className="mt-1.5">
        <a
          href={href}
          className={cn(
            "font-mono text-2xl font-medium leading-none tracking-[-0.02em] tabular-nums",
            tone,
            "underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          )}
        >
          {value}
          <span className="sr-only"> — open {label.toLowerCase()}</span>
        </a>
        <span className="mt-1.5 block text-2xs text-ink-muted">{hint}</span>
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Disruptions                                                                 */
/* -------------------------------------------------------------------------- */

export function DisruptionList({
  disruptions,
}: {
  disruptions: { id: string; courseCode: string; kind: string; note: string | null; dateLabel: string; detail: string }[];
}) {
  if (disruptions.length === 0) return null;

  return (
    <Panel as="section" aria-labelledby="disruptions">
      <PanelHeader
        id="disruptions"
        title="Schedule changes"
        description="Cancellations and relocations in the next three weeks"
      />
      <ul className="divide-y divide-rule">
        {disruptions.map((disruption) => (
          <li
            key={disruption.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
          >
            <span className="font-mono text-2xs tabular-nums text-ink-subtle">
              {disruption.dateLabel}
            </span>
            <span className="font-mono text-2xs font-medium text-ink">{disruption.courseCode}</span>
            <span className="text-2xs text-ink-muted">{disruption.detail}</span>
            {disruption.note ? (
              <span className="basis-full text-2xs text-ink-subtle">{disruption.note}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * "3h 30m scheduled" for the schedule header.
 *
 * Derived from the real instants rather than from the display strings, so a
 * class relocated to a different slot still contributes its actual duration.
 */
export function scheduledLabel(occurrences: ClassOccurrence[]): string {
  const totalMinutes = occurrences.reduce(
    (total, occurrence) =>
      total + (occurrence.endsAt.getTime() - occurrence.startsAt.getTime()) / 60_000,
    0,
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours === 0) return `${minutes}m scheduled`;
  if (minutes === 0) return `${hours}h scheduled`;
  return `${hours}h ${minutes}m scheduled`;
}
