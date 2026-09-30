import { cn } from "@/lib/cn";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { GradeStamp, Meter, Figure } from "@/components/ui/data-display";
import { Code } from "@/components/ui/badge";
import {
  GRADE_SCALE,
  formatGpa,
  formatPercent,
  letterFor,
  standingFor,
  PASS_LETTER,
  type LetterGrade,
} from "@/lib/grades";
import { formatDayMonth } from "@/lib/dates";
import type { CourseGrade, Standing } from "@/server/academic";
import { WorkBadge } from "./vocabulary";

/**
 * The grade book.
 *
 * Every course gets a card with three numbers, in this order and always in this
 * order:
 *
 *  - **earned** — the percentage across work already marked
 *  - **carried** — how much of the final mark that represents
 *  - **remaining** — what is left to earn it
 *
 * The second number is the one that stops this page being misleading. `88%` at
 * week 6 across 40% of the mark is not an 88; it is 88 on the part that exists,
 * and showing the part alongside is what keeps the page honest.
 *
 * Where the instructor has released a final mark, the seal is a stamp and the
 * projections are replaced by the record. Where they have not, the stamp is
 * dashed and reads `IP` — a different claim, and it looks like one.
 */

/* -------------------------------------------------------------------------- */
/* Standing                                                                    */
/* -------------------------------------------------------------------------- */

export function StandingPanel({
  standing,
  courses,
}: {
  standing: Standing;
  courses: CourseGrade[];
}) {
  const inProgressPoints = standing.inProgressPoints;
  const inProgressCredits = standing.inProgressCredits;
  // The in-progress term's own average, which is *not* the cumulative GPA and
  // must not be displayed as one. A student mid-term has no cumulative GPA that
  // includes ungraded coursework, so it is shown as a separate figure with its
  // own label rather than folded into the headline.
  const termAverage =
    inProgressCredits > 0 && inProgressPoints !== 0
      ? inProgressPoints / inProgressCredits
      : null;

  const sealed = standing.cumulativeGpa !== null;
  const standingLabel = sealed ? standingFor(standing.cumulativeGpa!) : null;

  return (
    <Panel as="section" aria-labelledby="standing">
      <PanelHeader
        id="standing"
        title="Academic standing"
        description={
          sealed
            ? "Your sealed transcript, plus the term currently in progress."
            : "No sealed transcript yet — the figures below cover the term in progress."
        }
      />

      <div className="grid gap-x-6 gap-y-5 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          value={sealed ? formatGpa(standing.cumulativeGpa!) : "—"}
          label="Cumulative GPA"
          hint={
            sealed
              ? standingLabel
                ? `${standingLabel.label} standing`
                : undefined
              : "Awarded at the end of each term"
          }
          tone={sealed && standingLabel?.tone === "risk" ? "warn" : "neutral"}
        />

        <Figure
          value={standing.creditsEarned ?? "—"}
          label="Credits earned"
          hint={
            standing.creditsAttempted
              ? `of ${standing.creditsAttempted} attempted`
              : "Across all sealed terms"
          }
        />

        <Figure
          value={termAverage === null ? "—" : formatGpa(termAverage)}
          label="This term, so far"
          hint={`${inProgressCredits} credits in progress`}
          tone="info"
        />

        <div className="min-w-0">
          <p className="font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">
            Grade scale
          </p>
          <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1">
            {GRADE_SCALE.filter((band) => band.letter !== "A+").map((band) => (
              <span key={band.letter} className="font-mono text-2xs tabular-nums text-ink-muted">
                <span className="text-ink">{band.letter}</span>
                <span className="text-ink-subtle"> {band.minPercent}+</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-ink-subtle">
            {PASS_LETTER} and above is a pass.
          </p>
        </div>
      </div>

      <div className="border-t border-rule px-4 py-3">
        <p className="text-2xs leading-relaxed text-ink-subtle">
          {courses.length > 0
            ? `${courses.reduce((sum, course) => sum + course.course.credits, 0)} credits enrolled this term across ${courses.length} course${courses.length === 1 ? "" : "s"}.`
            : "No course enrolments this term."}{" "}
          Marks are provisional until your instructor releases a final grade.
        </p>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Grade book                                                                  */
/* -------------------------------------------------------------------------- */

export function GradeBook({ courses }: { courses: CourseGrade[] }) {
  if (courses.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No grades yet"
          description="You have no course enrolments with published assessments. Enrolment records appear here as soon as they are registered."
        />
      </Panel>
    );
  }

  // Highest current average first, so the best-performing course leads. Stable
  // tie-break on code: a table that reshuffles between equal rows is noise.
  const sorted = [...courses].sort((a, b) => {
    const left = a.summary.currentPercent ?? -1;
    const right = b.summary.currentPercent ?? -1;
    if (left !== right) return right - left;
    return a.course.code.localeCompare(b.course.code);
  });

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      {sorted.map((course) => (
        <CourseGradeCard key={course.id} course={course} />
      ))}
    </div>
  );
}

function CourseGradeCard({ course }: { course: CourseGrade }) {
  const { summary } = course;
  const sealed = course.final?.finalPercent !== null && course.final?.finalPercent !== undefined;

  return (
    <Panel as="article" aria-labelledby={`grade-${course.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-rule px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <Code>{course.course.code}</Code>
            <span className="font-mono text-2xs text-ink-subtle">
              {course.sectionNo} · {course.course.credits} cr
            </span>
          </div>
          <h2
            id={`grade-${course.id}`}
            className="mt-1 truncate text-md font-semibold tracking-[-0.012em] text-ink"
          >
            {course.course.title}
          </h2>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {course.instructor?.name ?? "Instructor not recorded"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {sealed ? (
            <GradeStamp letter={course.final!.letterGrade as LetterGrade | null} />
          ) : (
            <GradeStamp letter="IP" />
          )}
          <div className="text-right">
            <p className="font-mono text-xl font-medium leading-none tabular-nums text-ink">
              {sealed
                ? formatPercent(course.final!.finalPercent)
                : summary.currentPercent === null
                  ? "—"
                  : formatPercent(summary.currentPercent)}
            </p>
            <p className="mt-1 font-mono text-2xs uppercase tracking-[0.1em] text-ink-subtle">
              {sealed ? "Final" : summary.gradedWeight === 0 ? "Not marked" : "To date"}
            </p>
          </div>
        </div>
      </div>

      {/* The three numbers, and the meter that relates them. */}
      <div className="border-b border-rule px-4 py-3">
        {sealed ? (
          <p className="text-xs leading-relaxed text-ink-muted">
            Released{" "}
            {course.final!.finalPercent === null ? "—" : formatPercent(course.final!.finalPercent)}
            {course.final!.creditsEarned !== null
              ? ` · ${course.final!.creditsEarned} credits earned`
              : ""}
            .
          </p>
        ) : (
          <>
            <Meter
              value={summary.gradedWeight}
              striped
              label={`${summary.gradedWeight}% of the final mark has been graded`}
            />
            <dl className="mt-2.5 grid grid-cols-3 gap-3">
              <Term
                label="Earned"
                value={
                  summary.currentPercent === null
                    ? "—"
                    : formatPercent(summary.currentPercent)
                }
              />
              <Term label="Carried" value={`${summary.gradedWeight}%`} />
              <Term
                label="Remaining"
                value={`${summary.outstandingWeight}%`}
                tone={summary.outstandingWeight > 0 ? "warn" : "neutral"}
              />
            </dl>
            {!summary.weightsAreSuspect && summary.projectedLetter ? (
              <p className="mt-2.5 text-2xs leading-relaxed text-ink-subtle">
                Currently {summary.projectedLetter} on marked work.{" "}
                {summary.maximumAchievablePercent > summary.currentPercent! ? (
                  <>
                    Full marks on everything still outstanding would reach{" "}
                    {letterFor(summary.maximumAchievablePercent)};{" "}
                  </>
                ) : (
                  <>You are already at the ceiling of what is left to earn. </>
                )}
                You cannot fall below {formatPercent(summary.minimumGuaranteedPercent)} however
                the rest goes.
              </p>
            ) : null}
          </>
        )}
      </div>

      <ul className="divide-y divide-rule">
        {course.items.length === 0 ? (
          <li className="px-4 py-3 text-xs text-ink-muted">
            No assessments published for this section yet.
          </li>
        ) : (
          course.items.map((item) => (
            <AssessmentLine key={item.id} item={item} />
          ))
        )}
      </ul>
    </Panel>
  );
}

function Term({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div>
      <dt className="font-mono text-2xs uppercase tracking-[0.12em] text-ink-subtle">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 font-mono text-sm tabular-nums",
          tone === "warn" ? "text-ochre-hover" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function AssessmentLine({
  item,
}: {
  item: CourseGrade["items"][number];
}) {
  const graded = item.percent !== null;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-xs text-ink">{item.title}</p>
        <p className="mt-0.5 font-mono text-2xs tabular-nums text-ink-subtle">
          {item.weightPercent}% · {item.kind.toLowerCase().replace(/_/g, " ")}
          {item.gradedAt ? ` · marked ${formatDayMonth(item.gradedAt)}` : ""}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {graded ? (
          <span className="font-mono text-xs tabular-nums text-ink">
            {item.score === null ? "—" : item.score}/{item.maxScore}
          </span>
        ) : (
          <WorkBadge state={item.state} />
        )}
        <span
          className={cn(
            "w-14 shrink-0 text-right font-mono text-xs tabular-nums",
            graded ? "text-accent" : "text-ink-subtle",
          )}
        >
          {graded ? formatPercent(item.percent) : "—"}
        </span>
      </div>

      {item.feedback ? (
        <p className="basis-full border-l-2 border-accent/30 pl-3 text-2xs leading-relaxed text-ink-muted">
          {item.feedback}
        </p>
      ) : null}
    </li>
  );
}
