import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getShellContext } from "@/server/context";
import { getCourseGrades, getStanding } from "@/server/academic";
import { PageHeader } from "@/components/ui/panel";
import { GradeBook, StandingPanel } from "@/components/pages/gradebook";

export const metadata: Metadata = { title: "Grades" };

/**
 * Grades.
 *
 * The screen where the most is at stake and the least can be known, so the page
 * is built around an honest answer to "how am I doing?" rather than around the
 * number itself.
 *
 * Three decisions carry that:
 *
 * 1. **Projected, not final.** A letter is only stamped once the term is sealed.
 *    Before then the page shows a percentage and a *range* — what is already
 *    earned against what is still reachable — because a single projected letter
 *    implies a precision that does not exist, and students make decisions based
 *    on it.
 *
 * 2. **Weights are audited, not assumed.** If a course's weights do not add to
 *    100 the page says so. Silently renormalising hides a real data fault that
 *    the student is the one who gets asked about later.
 *
 * 3. **The scale is stated.** A percentage is meaningless without knowing whether
 *    88 is an A or a B, so the band scale appears once at the top rather than
 *    leaving every reader to recall it.
 */

export default async function GradesPage() {
  const context = await getShellContext();
  if (!context) redirect("/login");

  const [courses, standing] = await Promise.all([
    getCourseGrades(context.user.id, context.now),
    getStanding(context.user.id),
  ]);

  const suspect = courses.filter((course) => course.summary.weightsAreSuspect);

  return (
    <>
      <PageHeader
        eyebrow={context.term ? `${context.term.code} · in progress` : undefined}
        title="Grades"
        description="Weighted marks for every course you are taking. Grades are provisional until your instructor releases the final mark."
      />

      <div className="space-y-5">
        <StandingPanel standing={standing} courses={courses} />

        {suspect.length > 0 ? (
          <div
            role="status"
            className="rounded-md border border-ochre/30 bg-ochre-subtle px-4 py-3 text-sm leading-relaxed text-ink"
          >
            <p className="font-medium text-ochre-hover">Some courses have an incomplete mark scheme</p>
            <p className="mt-1 text-xs text-ink-muted">
              The assessments on{" "}
              {suspect.map((course) => course.course.code).join(", ")} do not add up to 100% of the
              final mark. Percentages on those courses are shown as marked, without a projection.
              If this persists, raise it with the department — it is not something the portal can
              correct.
            </p>
          </div>
        ) : null}

        <GradeBook courses={courses} />
      </div>
    </>
  );
}
