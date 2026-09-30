import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getShellContext } from "@/server/context";
import { getAssessments, type AssessmentFilter } from "@/server/academic";
import { PageHeader } from "@/components/ui/panel";
import { AssessmentFilterBar } from "@/components/pages/assignment-filter";
import { AssessmentList } from "@/components/pages/assessment-list";

export const metadata: Metadata = { title: "Assignments" };

/**
 * Assignments.
 *
 * A list first, a form second. The action on this screen — "what do I still
 * owe, and by when" — is answered by a filtered list, and the page is built to
 * make that list the default rather than something a student has to configure.
 *
 * The filter is a URL search param rather than component state, for two reasons:
 * a filtered view is linkable, which matters when a student sends an instructor
 * "this is what I still have"; and it survives a refresh, which state does not.
 * An unrecognised value falls back to `open` rather than 404ing — a stale link
 * from an email should land the student somewhere useful.
 */

const FILTERS: AssessmentFilter[] = ["open", "submitted", "graded", "overdue", "all"];

function isFilter(value: string): value is AssessmentFilter {
  return (FILTERS as string[]).includes(value);
}

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getShellContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const raw = typeof params.filter === "string" ? params.filter : "open";
  const filter: AssessmentFilter = isFilter(raw) ? raw : "open";

  // One fetch of the unfiltered set, counted in JS. `getAssessments` filters
  // after loading anyway, so asking for `all` is the same query it would have run
  // for any other value — and every filter count falls out of it for free. A
  // second filtered call would be a second query over the same rows for numbers
  // that are pure functions of the first result.
  const rows = await getAssessments(context.user.id, context.now, "all");
  const visible =
    filter === "all" ? rows : rows.filter((row) => matches(row.state, filter));

  return (
    <>
      <PageHeader
        eyebrow={context.term ? context.term.code : undefined}
        title="Assignments"
        description="Everything set on your sections, with your submission state against each item."
      />

      <AssessmentFilterBar active={filter} counts={counts(rows)} />

      <div className="mt-5">
        <AssessmentList
          items={visible}
          now={context.now}
          timezone={context.timezone}
          emptyFor={filter}
        />
      </div>
    </>
  );
}

/**
 * Mirrors `applyAssessmentFilter` in `server/academic.ts`.
 *
 * Duplicated rather than exported because the counts need to come from a single
 * unfiltered fetch, and the server function filters as its last step — exporting
 * the predicate separately would mean the same rule is stated once and still
 * risks drifting. Both are three lines; a five-way switch duplicated is cheaper
 * than a wrong count on a chip that exists precisely to be trusted.
 */
function matches(state: string, filter: AssessmentFilter): boolean {
  switch (filter) {
    case "open":
      return state === "NOT_STARTED" || state === "DRAFT" || state === "OVERDUE";
    case "overdue":
      return state === "OVERDUE";
    case "submitted":
      return state === "SUBMITTED" || state === "LATE";
    case "graded":
      return state === "GRADED" || state === "RETURNED";
    case "all":
      return true;
  }
}

function counts(rows: ReadonlyArray<{ state: string }>): Record<AssessmentFilter, number> {
  const tally: Record<AssessmentFilter, number> = {
    open: 0,
    submitted: 0,
    graded: 0,
    overdue: 0,
    all: rows.length,
  };
  for (const row of rows) {
    for (const filter of FILTERS) {
      if (filter !== "all" && matches(row.state, filter)) tally[filter] += 1;
    }
  }
  return tally;
}
