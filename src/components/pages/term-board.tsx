import Link from "next/link";
import { cn } from "@/lib/cn";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { Badge, Code } from "@/components/ui/badge";
import { LedgerSpine } from "@/components/shell/ledger-spine";
import { DataRow } from "@/components/ui/data-display";
import { formatDayMonth, formatRelativeDay, nearTerm } from "@/lib/dates";
import type { SectionSummary } from "@/server/academic";
import type { TermContext } from "@/server/context";
import { formatPercent } from "@/lib/grades";

/**
 * The term board.
 *
 * Three blocks, in the order a student asks for them:
 *
 *  1. **Where the term is.** The full spine, plus what is left and when the last
 *     class is. This is the one number people check on their way out the door.
 *  2. **The timetable.** A real table, one row per weekday, because it is the
 *     thing people print and the thing screen readers can navigate.
 *  3. **The courses.** A card each: credits, instructor, room, and the times it
 *     meets — the timetable again, but per-course, because "when is Algorithms"
 *     is a more common question than "when is everything".
 */

export function TermBoard({
  sections,
  term,
  timezone,
  now,
  weekStartsOn,
}: {
  sections: SectionSummary[];
  term: TermContext | null;
  timezone: string;
  now: Date;
  weekStartsOn: number;
}) {
  if (!term) {
    return (
      <Panel>
        <EmptyState
          title="No term published"
          description="The academic calendar has not been published for this period. Your enrolments, grades and attendance are unaffected and remain available on their own pages."
          action={
            <Link
              href="/today"
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Back to today
            </Link>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <TermPosition term={term} timezone={timezone} now={now} />

      {sections.length === 0 ? (
        <Panel>
          <EmptyState
            title="Not enrolled"
            description="You have no course enrolments this term. If you believe this is wrong, contact the registrar — enrolment records are the registrar's to correct, not the portal's."
          />
        </Panel>
      ) : (
        <>
          <Timetable sections={sections} weekStartsOn={weekStartsOn} />
          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            {sections.map((section) => (
              <CourseCard key={section.id} section={section} now={now} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Position                                                                    */
/* -------------------------------------------------------------------------- */

function TermPosition({
  term,
  timezone,
  now,
}: {
  term: TermContext;
  timezone: string;
  now: Date;
}) {
  return (
    <Panel as="section" aria-labelledby="term-position">
      <PanelHeader
        id="term-position"
        title={term.name}
        description={`${term.code} · ${term.weekCount} weeks`}
      />

      <div className="px-4 py-4">
        <LedgerSpine
          variant="full"
          progress={term.progress}
          week={term.week}
          weekCount={term.weekCount}
          termName={term.name}
          daysRemaining={term.daysRemaining}
        />

        {/* The term's own dates, with each one placed relative to today. A bare
            "17 Aug 2026" makes the student do the subtraction against whatever
            date they think it is; "17 Aug 2026 · 6 weeks ago" does not. The
            relative half is dropped past two weeks, where it would only be a
            second date — see `nearTerm`. */}
        <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <DataRow label="Week">
            {term.isAfterTerm
              ? "Complete"
              : term.isBeforeTerm
                ? "Not started"
                : `${term.week} of ${term.weekCount}`}
          </DataRow>
          <DataRow label="Days remaining">
            {term.isAfterTerm ? "—" : String(term.daysRemaining)}
          </DataRow>
          <DataRow label="Started">
            <time dateTime={term.startsOn.toISOString()}>
              {formatDayMonth(term.startsOn, timezone)}
            </time>
            {nearTerm(term.startsOn, now, timezone) ? (
              <span className="text-ink-subtle">
                {" · "}
                {formatRelativeDay(term.startsOn, now, timezone).toLowerCase()}
              </span>
            ) : null}
          </DataRow>
          <DataRow label="Ends">
            <time dateTime={term.endsOn.toISOString()}>
              {formatDayMonth(term.endsOn, timezone)}
            </time>
            {nearTerm(term.endsOn, now, timezone) ? (
              <span className="text-ink-subtle">
                {" · "}
                {formatRelativeDay(term.endsOn, now, timezone).toLowerCase()}
              </span>
            ) : null}
          </DataRow>
        </dl>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Timetable                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Weekly timetable.
 *
 * A `<table>` with a row per weekday and a cell per course slot, built from
 * explicit column widths rather than a time axis. A proportional time axis looks
 * better on screen but produces column widths that do not line up between
 * courses, and a timetable whose columns do not line up is a timetable nobody can
 * read across.
 *
 * Conflict detection is real, not cosmetic: if two meetings occupy the same slot
 * the cell is marked and the conflict is named. The seed data and the schema
 * both permit it — a clash is a registration error the student needs to see, not
 * something the view layer should quietly resolve by dropping one.
 */
function Timetable({
  sections,
  weekStartsOn,
}: {
  sections: SectionSummary[];
  weekStartsOn: number;
}) {
  const days = orderDays(sections, weekStartsOn);
  const hasAny = sections.some((section) => section.meetings.length > 0);

  return (
    <Panel as="section" aria-labelledby="timetable">
      <PanelHeader
        id="timetable"
        title="Weekly timetable"
        description={
          hasAny
            ? "Recurring meetings for this term. Room changes and cancellations are on the Today page."
            : undefined
        }
      />

      {!hasAny ? (
        <EmptyState
          compact
          title="No meetings published"
          description="None of your sections have published meeting times yet."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            <caption className="sr-only">
              Weekly timetable. Each row is a weekday; each column is a course.
            </caption>
            <thead>
              <tr className="border-b border-rule">
                <th
                  scope="col"
                  className="w-28 px-4 py-2 font-mono text-2xs font-normal uppercase tracking-[0.13em] text-ink-subtle"
                >
                  Day
                </th>
                {sections.map((section) => (
                  <th
                    key={section.id}
                    scope="col"
                    className="px-3 py-2 align-bottom"
                  >
                    <Code>{section.course.code}</Code>
                    <span className="mt-1 block max-w-[12rem] truncate text-2xs font-normal text-ink-muted">
                      {section.sectionNo}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.dayOfWeek} className="border-b border-rule align-top last:border-b-0">
                  <th
                    scope="row"
                    className="px-4 py-2.5 text-xs font-medium text-ink-muted"
                  >
                    {DAY_NAMES[day.dayOfWeek]}
                  </th>
                  {sections.map((section) => {
                    const meetings = section.meetings.filter(
                      (meeting) => meeting.dayOfWeek === day.dayOfWeek,
                    );
                    const conflicts = meetings.length > 1;

                    return (
                      <td key={section.id} className="px-3 py-2.5">
                        {meetings.length === 0 ? (
                          <span aria-hidden className="text-2xs text-ink-subtle">
                            —
                          </span>
                        ) : (
                          <ul className="space-y-1.5">
                            {meetings.map((meeting) => (
                              <li key={meeting.id}>
                                <span className="block font-mono text-2xs tabular-nums text-ink">
                                  {meeting.timeLabel}
                                </span>
                                {meeting.room ? (
                                  <span className="block text-2xs text-ink-muted">
                                    {meeting.room}
                                  </span>
                                ) : (
                                  <span className="block text-2xs text-ink-subtle">
                                    Room to be confirmed
                                  </span>
                                )}
                                <span className="block text-2xs text-ink-subtle">
                                  {meeting.kind.toLowerCase()}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {conflicts ? (
                          <span
                            role="status"
                            className="mt-1.5 block rounded-xs bg-danger-subtle px-1.5 py-0.5 text-[0.6rem] leading-snug text-danger-hover"
                          >
                            Clashing meetings — check with the registrar
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const DAY_NAMES: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

/**
 * Only the days something actually meets on, in the user's week order.
 *
 * A timetable with seven rows where four are empty is a worse timetable than one
 * with three rows that are full — the empty rows are pure scanning cost. The
 * user's `weekStartsOn` decides the order, so a Sunday-first week reads
 * correctly for anyone who set it that way.
 */
function orderDays(sections: SectionSummary[], weekStartsOn: number) {
  const used = new Set<number>();
  for (const section of sections) {
    for (const meeting of section.meetings) used.add(meeting.dayOfWeek);
  }
  return [...used]
    .sort((a, b) => ((a - weekStartsOn + 7) % 7) - ((b - weekStartsOn + 7) % 7))
    .map((dayOfWeek) => ({ dayOfWeek }));
}

/* -------------------------------------------------------------------------- */
/* Course cards                                                                */
/* -------------------------------------------------------------------------- */

function CourseCard({ section, now }: { section: SectionSummary; now: Date }) {
  const { course, instructor, meetings } = section;
  const first = meetings[0];

  return (
    <Panel as="article" aria-labelledby={`course-${section.id}`}>
      <div className="border-b border-rule px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <Code>{course.code}</Code>
          <span className="font-mono text-2xs text-ink-subtle">
            {section.sectionNo} · {course.credits} cr · level {course.level}
          </span>
          {section.status !== "ACTIVE" ? (
            <Badge tone="neutral">{section.status.toLowerCase()}</Badge>
          ) : null}
        </div>
        <h3
          id={`course-${section.id}`}
          className="mt-1 text-md font-semibold tracking-[-0.012em] text-ink"
        >
          {course.title}
        </h3>
        <p className="mt-0.5 text-2xs text-ink-muted">{course.department}</p>
      </div>

      {course.description ? (
        <p className="border-b border-rule px-4 py-3 text-xs leading-relaxed text-ink-muted">
          {course.description}
        </p>
      ) : null}

      <dl className="px-4 py-1">
        <DataRow label="Instructor">
          {instructor ? (
            <span className="block">
              <span className="block text-ink">{instructor.name}</span>
              {instructor.title ? (
                <span className="block text-2xs text-ink-subtle">{instructor.title}</span>
              ) : null}
              {instructor.email ? (
                <a
                  href={`mailto:${instructor.email}`}
                  className="mt-0.5 block font-mono text-2xs text-accent underline-offset-2 hover:underline"
                >
                  {instructor.email}
                </a>
              ) : null}
            </span>
          ) : (
            <span className="text-ink-subtle">Not recorded</span>
          )}
        </DataRow>

        <DataRow label="Meets">
          {meetings.length === 0 ? (
            <span className="text-ink-subtle">Times to be confirmed</span>
          ) : (
            <span className="block space-y-0.5">
              {meetings.map((meeting) => (
                <span key={meeting.id} className="block">
                  <span className="font-mono tabular-nums">{meeting.timeLabel}</span>
                  <span className="text-ink-subtle">
                    {" · "}
                    {DAY_NAMES[meeting.dayOfWeek].slice(0, 3)} · {meeting.kind.toLowerCase()}
                  </span>
                  {meeting.room ? (
                    <span className="block text-2xs text-ink-subtle">{meeting.room}</span>
                  ) : null}
                </span>
              ))}
            </span>
          )}
        </DataRow>

        <DataRow label="Room">
          {section.room ?? first?.room ?? <span className="text-ink-subtle">To be confirmed</span>}
        </DataRow>

        <DataRow label="Marked">
          {section.assessmentCount === 0 ? (
            <span className="text-ink-subtle">No assessments published</span>
          ) : (
            <span className="font-mono tabular-nums">
              {section.gradedCount} of {section.assessmentCount} graded
              {section.gradedCount > 0 && section.assessmentCount > section.gradedCount ? (
                <span className="ml-1 font-sans text-2xs text-ink-subtle">
                  ({formatPercent((section.gradedCount / section.assessmentCount) * 100)} complete)
                </span>
              ) : null}
            </span>
          )}
        </DataRow>
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-rule px-4 py-2.5">
        <Link
          href={`/assignments?course=${section.id}`}
          className="text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Assignments
        </Link>
        {instructor ? (
          <Link
            href={`/messages?to=${instructor.id}`}
            className={cn(
              "text-xs text-ink-muted underline-offset-2 hover:underline",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            )}
          >
            Message {instructor.name.split(" ").slice(-1)[0]}
          </Link>
        ) : null}
        {meetsNow(section, now) ? (
          <Badge tone="good" dot>
            Meeting now
          </Badge>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * "Is this course meeting right now?"
 *
 * Scoped to five minutes either side of a start time rather than to the whole
 * meeting window, for two reasons: the server clock means this is only true at
 * the instant the page was rendered, so it must be narrow to avoid asserting
 * something that is false by the time it is read; and a class that started at
 * 09:00 should stop reading "meeting now" by 09:20, not at 10:30.
 *
 * Read in UTC against `startMin`, which the schema stores as minutes from
 * midnight in the institution's zone. That is exact only when the server is in
 * the same zone, which it is not in general — so this is a hint, never a fact,
 * and the Today page is where the authoritative "in progress" marker lives.
 */
function meetsNow(section: SectionSummary, now: Date): boolean {
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  const day = now.getUTCDay();
  return section.meetings.some(
    (meeting) =>
      meeting.dayOfWeek === day && Math.abs(minuteOfDay - meeting.startMin) <= 5,
  );
}
