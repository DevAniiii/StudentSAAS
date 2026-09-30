import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/panel";
import { EmptyState, NotFoundState } from "@/components/ui/states";
import { Badge, Code } from "@/components/ui/badge";
import { formatDateTime, formatRelativeDay, formatTime } from "@/lib/dates";
import { formatPercent } from "@/lib/grades";
import type { AssessmentRow, AssessmentFilter } from "@/server/academic";
import { WorkBadge, kindLabel } from "./vocabulary";

/**
 * The assessment list.
 *
 * Grouped by course, not by date.
 *
 * A flat date-sorted list is the obvious layout and the wrong one: a student
 * wants to answer "how am I doing in Algorithms?" and a global deadline ordering
 * interleaves six courses into an unreadable column of repeated course names.
 * Within each group, items are ordered by deadline, and the group carries its own
 * weight total so the shape of the course's mark is visible without arithmetic.
 *
 * Overdue items inside a group are hoisted above the rest, matching the Today
 * screen's rule. A deadline sort that leaves an item three weeks late below four
 * items due in November is technically ordered and practically useless.
 */

const EMPTY_COPY: Record<AssessmentFilter, { title: string; body: string }> = {
  open: {
    title: "Nothing outstanding",
    body: "Every assessment on your sections has been submitted or graded. Well done.",
  },
  overdue: {
    title: "Nothing is overdue",
    body: "No item on your sections is past its deadline without a submission.",
  },
  submitted: {
    title: "Nothing awaiting a mark",
    body: "Work you submit appears here until it is graded and returned.",
  },
  graded: {
    title: "Nothing graded yet",
    body: "Marked work appears here with your score and any feedback.",
  },
  all: {
    title: "No assessments set",
    body: "Your instructors have not published any assessments for these sections yet.",
  },
};

export function AssessmentList({
  items,
  now,
  timezone,
  emptyFor,
}: {
  items: AssessmentRow[];
  now: Date;
  timezone: string;
  emptyFor: AssessmentFilter;
}) {
  if (items.length === 0) {
    const copy = EMPTY_COPY[emptyFor];
    return (
      <Panel>
        <EmptyState
          title={copy.title}
          description={copy.body}
          action={
            emptyFor === "all" || emptyFor === "open" ? undefined : (
              <a
                href="/assignments"
                className="text-xs font-medium text-accent underline-offset-2 hover:underline"
              >
                Show everything
              </a>
            )
          }
        />
      </Panel>
    );
  }

  const groups = groupByCourse(items);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <CourseGroup
          key={group.sectionId}
          courseCode={group.courseCode}
          courseTitle={group.courseTitle}
          weightTotal={group.weightTotal}
          gradedWeight={group.gradedWeight}
          items={group.items}
          now={now}
          timezone={timezone}
        />
      ))}
    </div>
  );
}

function groupByCourse(items: AssessmentRow[]) {
  const map = new Map<
    string,
    {
      sectionId: string;
      courseCode: string;
      courseTitle: string;
      items: AssessmentRow[];
      weightTotal: number;
      gradedWeight: number;
    }
  >();

  for (const item of items) {
    let group = map.get(item.sectionId);
    if (!group) {
      group = {
        sectionId: item.sectionId,
        courseCode: item.courseCode,
        courseTitle: item.courseTitle,
        items: [],
        weightTotal: 0,
        gradedWeight: 0,
      };
      map.set(item.sectionId, group);
    }
    group.items.push(item);
    group.weightTotal += item.weightPercent;
    if (item.state === "GRADED" || item.state === "RETURNED") {
      group.gradedWeight += item.weightPercent;
    }
  }

  // Courses with the most outstanding weight first — that is the one a student
  // behind on marks should open next. Tie-broken by code so the order is stable
  // across visits, because a list that reshuffles is a list people cannot
  // develop a habit around.
  return [...map.values()].sort((a, b) => {
    const aOutstanding = a.weightTotal - a.gradedWeight;
    const bOutstanding = b.weightTotal - b.gradedWeight;
    if (aOutstanding !== bOutstanding) return bOutstanding - aOutstanding;
    return a.courseCode.localeCompare(b.courseCode);
  });
}

function CourseGroup({
  courseCode,
  courseTitle,
  weightTotal,
  gradedWeight,
  items,
  now,
  timezone,
}: {
  courseCode: string;
  courseTitle: string;
  weightTotal: number;
  gradedWeight: number;
  items: AssessmentRow[];
  now: Date;
  timezone: string;
}) {
  // Hoist overdue, keep the deadline order for the rest.
  const ordered = [
    ...items.filter((item) => item.state === "OVERDUE"),
    ...items.filter((item) => item.state !== "OVERDUE"),
  ];
  const overdueCount = items.filter((item) => item.state === "OVERDUE").length;

  return (
    <Panel as="article" aria-labelledby={`group-${courseCode}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b border-rule px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <Code>{courseCode}</Code>
          <h2 id={`group-${courseCode}`} className="min-w-0 truncate text-md font-semibold tracking-[-0.012em] text-ink">
            {courseTitle}
          </h2>
        </div>
        <p className="shrink-0 font-mono text-2xs tabular-nums text-ink-subtle">
          {gradedWeight}% of {weightTotal}% marked
        </p>
      </div>

      {overdueCount > 0 ? (
        <p className="border-b border-rule bg-danger-subtle px-4 py-1.5 font-mono text-2xs uppercase tracking-[0.13em] text-danger-hover">
          {overdueCount} overdue
        </p>
      ) : null}

      <ul className="divide-y divide-rule">
        {ordered.map((item) => (
          <AssessmentRow key={item.id} item={item} now={now} timezone={timezone} />
        ))}
      </ul>
    </Panel>
  );
}

function AssessmentRow({
  item,
  now,
  timezone,
}: {
  item: AssessmentRow;
  now: Date;
  timezone: string;
}) {
  const urgent = item.hoursUntilDue !== null && item.hoursUntilDue <= 48 && item.state !== "GRADED";
  const overdue = item.state === "OVERDUE";

  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="min-w-0 text-sm font-medium text-ink">{item.title}</p>
          <Badge tone="neutral">{kindLabel(item.kind)}</Badge>
          <span className="font-mono text-2xs tabular-nums text-ink-subtle">
            {item.weightPercent}% of mark
          </span>
        </div>

        {item.brief ? (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">
            {item.brief}
          </p>
        ) : null}

        <p className="mt-1.5 font-mono text-2xs text-ink-subtle">
          {item.instructorName ?? "Instructor not recorded"}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
        <div className="flex items-center gap-2">
          <WorkBadge state={item.state} />
          {item.submission?.percent !== null && item.submission?.percent !== undefined ? (
            <span className="font-mono text-xs tabular-nums text-ink">
              {formatPercent(item.submission.percent)}
            </span>
          ) : null}
        </div>

        <Deadline item={item} now={now} timezone={timezone} urgent={urgent} overdue={overdue} />
      </div>
    </li>
  );
}

function Deadline({
  item,
  now,
  timezone,
  urgent,
  overdue,
}: {
  item: AssessmentRow;
  now: Date;
  timezone: string;
  urgent: boolean;
  overdue: boolean;
}) {
  if (!item.dueAt) {
    return <p className="font-mono text-2xs text-ink-subtle">No deadline set</p>;
  }

  const due = item.dueAt;

  return (
    <div className="text-left sm:text-right">
      <time
        dateTime={due.toISOString()}
        className={cn(
          "block font-mono text-2xs tabular-nums",
          overdue ? "text-danger-hover" : urgent ? "text-ochre-hover" : "text-ink-muted",
        )}
      >
        {overdue ? "Was due " : "Due "}
        {formatRelativeDay(due, now, timezone)}
      </time>
      <span className="block font-mono text-2xs tabular-nums text-ink-subtle">
        {formatTime(due, timezone)}
      </span>
      {item.submission?.submittedAt ? (
        <span className="mt-0.5 block text-2xs text-ink-subtle">
          Handed in {formatDateTime(item.submission.submittedAt, timezone)}
        </span>
      ) : null}
    </div>
  );
}

/** Kept exported so the Grades screen can reuse the not-found shape. */
export { NotFoundState };
