import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getShellContext } from "@/server/context";
import {
  getTodayClasses,
  getDisruptions,
  getAssessments,
  getStanding,
} from "@/server/academic";
import { getAttendanceOverview } from "@/server/attendance";
import { getFinanceOverview } from "@/server/finance";
import { getAnnouncements, getThreads } from "@/server/comms";
import { formatFullDate, formatTime, formatDayMonth, addDays } from "@/lib/dates";
import { formatMoney, sumCents, INSTITUTION_CURRENCY } from "@/lib/money";
import { PageHeader } from "@/components/ui/panel";
import { Avatar } from "@/components/ui/data-display";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { Badge, CourseChip } from "@/components/ui/badge";
import { Reveal } from "@/animations/reveal";
import {
  TodaySchedule,
  OutstandingWork,
  GlanceStrip,
  DisruptionList,
  scheduledLabel,
} from "@/components/pages/today-parts";
import { greeting } from "@/lib/greeting";

export const metadata: Metadata = { title: "Today" };

/**
 * Today.
 *
 * The only page in the product that answers "what should I do right now?", and
 * the only page allowed to be opinionated about ordering. Four bands, in this
 * order and always in this order:
 *
 *  1. **The glance strip.** Four numbers, the ones a student checks first.
 *  2. **Today's classes.** The spine is already at the top of the window, so this
 *     does not repeat term position — it answers the next hour's question.
 *  3. **Outstanding work.** Overdue first, then nearest deadline.
 *  4. **Everything else.** Course standing, schedule changes, new notices, unread
 *     mail — in that order, because those are read when the urgent band is quiet.
 *
 * The ordering is not dynamic. A dashboard that reorders itself between visits is
 * harder to build a mental model of than one with a fixed structure and
 * changing contents, and the student is the one who knows which band they want.
 */
export default async function TodayPage() {
  const context = await getShellContext();
  if (!context) redirect("/login");

  const { user, term, timezone, now, counts } = context;

  const [classes, assessments, attendance, finance, standing, threads, notices, disruptions] =
    await Promise.all([
      getTodayClasses(user.id, timezone, now),
      getAssessments(user.id, now, "all"),
      getAttendanceOverview(user.id, now),
      getFinanceOverview(user.id, now),
      getStanding(user.id),
      getThreads(user.id),
      getAnnouncements(user.id, now),
      getDisruptions(user.id, now, 21),
    ]);

  const outstanding = assessments.filter(
    (item) => item.state === "NOT_STARTED" || item.state === "DRAFT" || item.state === "OVERDUE",
  );

  // Outstanding weight, straight from the same assessment rows. Re-deriving this
  // from a second query would risk the two numbers disagreeing, and a weight on
  // this screen that does not match the Grades page is worse than no weight.
  const outstandingWeight = Math.round(
    outstanding.reduce((sum, item) => sum + item.weightPercent, 0),
  );

  const openInvoices = finance.invoices.filter(
    (invoice) => invoice.settlement === "OPEN" || invoice.settlement === "OVERDUE",
  );
  const balanceCents = sumCents(openInvoices.map((invoice) => invoice.balanceCents));
  const currency = finance.invoices[0]?.currency ?? INSTITUTION_CURRENCY;

  const unreadThreads = threads.filter((thread) => thread.unread).slice(0, 3);
  // Pinned notices first, then most recent. `getAnnouncements` returns the feed
  // in publication order, so pinning is applied here rather than costing the
  // query a second sort for what is usually a handful of rows.
  const recentNotices = [...notices]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .slice(0, 3);

  return (
    <>
      <PageHeader
        eyebrow={term ? `${term.code} · week ${term.week} of ${term.weekCount}` : "No active term"}
        title={greeting(user.firstName, now, timezone)}
        description={`${formatFullDate(now, timezone)} · ${formatTime(now, timezone)} ${timezone.replace(/_/g, " ")}`}
        actions={
          counts.dueSoon > 0 ? (
            <Badge tone="warn" size="md" dot>
              {counts.dueSoon} due within 3 days
            </Badge>
          ) : (
            <Badge tone="good" size="md" dot>
              Nothing due this week
            </Badge>
          )
        }
      />

      <Reveal className="mb-5">
        <GlanceStrip
          standing={standing}
          attendanceRate={attendance.total.present + attendance.total.late + attendance.total.absent > 0
            ? attendance.rate
            : null}
          outstandingCount={outstanding.length}
          outstandingWeight={outstandingWeight}
          balanceCents={balanceCents}
          currency={currency}
        />
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <Reveal className="lg:col-span-2" distance={14}>
          <TodaySchedule
            occurrences={classes}
            now={now}
            timezone={timezone}
            todayLabel={
              classes.length > 0
                ? `${classes.length} class${classes.length === 1 ? "" : "es"} · ${scheduledLabel(classes)}`
                : undefined
            }
          />
        </Reveal>

        <Reveal className="lg:col-span-2" distance={14} delay={0.04}>
          <OutstandingWork items={outstanding} now={now} timezone={timezone} />
        </Reveal>

        {/* --------------------------------------------------------- secondary */}
        <div className="grid gap-5 lg:col-span-2 lg:grid-cols-3 lg:items-start">
          <Reveal className="lg:col-span-1" delay={0.06}>
            <CourseStanding attendance={attendance} />
          </Reveal>

          <Reveal className="space-y-5 lg:col-span-1" delay={0.08}>
            <NoticesPanel notices={recentNotices} />
            <MessagesPanel threads={unreadThreads} />
          </Reveal>

          <Reveal className="space-y-5 lg:col-span-1" delay={0.1}>
            <DisruptionList
              disruptions={disruptions.slice(0, 5).map((disruption) => ({
                id: disruption.id,
                courseCode: disruption.courseCode,
                kind: disruption.kind,
                note: disruption.note,
                dateLabel:
                  disruption.daysAway === 0
                    ? "Today"
                    : disruption.daysAway === 1
                      ? "Tomorrow"
                      : formatDayMonth(addDays(now, disruption.daysAway), timezone),
                detail:
                  disruption.kind === "CANCELLED"
                    ? "Cancelled"
                    : disruption.room
                      ? `Moved to ${disruption.room}`
                      : "Rescheduled",
              }))}
            />
            {openInvoices.length > 0 ? (
              <Panel as="section" aria-labelledby="fees-due">
                <PanelHeader id="fees-due" title="Fees" description="Invoices needing payment" />
                <ul className="divide-y divide-rule">
                  {openInvoices.slice(0, 3).map((invoice) => (
                    <li key={invoice.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block font-mono text-2xs text-ink-muted">
                          {invoice.number}
                        </span>
                        <span className="block truncate text-xs text-ink">
                          {invoice.termName ?? invoice.lines[0]?.description ?? "Invoice"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-sm tabular-nums text-ink">
                          {/* Through `formatMoney`, not a bare `toLocaleString`.
                              The inline version used the runtime's locale, so this
                              figure grouped itself one way while every other amount
                              in the app grouped itself another — `₹113,000.00` here
                              against `₹1,13,000.00` on the finance page — and which
                              one you got depended on the server's environment. */}
                          {formatMoney(invoice.balanceCents, invoice.currency)}
                        </span>
                        <span
                          className={`block font-mono text-2xs ${invoice.isOverdue ? "text-danger-hover" : "text-ink-subtle"}`}
                        >
                          {invoice.isOverdue
                            ? "Overdue"
                            : invoice.daysUntilDue === 0
                              ? "Due today"
                              : `in ${invoice.daysUntilDue}d`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </Reveal>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function CourseStanding({
  attendance,
}: {
  attendance: Awaited<ReturnType<typeof getAttendanceOverview>>;
}) {
  const atRisk = attendance.courses.filter(
    (course) => course.verdict.risk === "at-risk" || course.verdict.risk === "blocked",
  );
  const worst = atRisk.length > 0 ? atRisk : attendance.courses.slice(0, 4);

  return (
    <Panel as="section" aria-labelledby="course-standing">
      <PanelHeader
        id="course-standing"
        title="Course standing"
        description={
          attendance.courseCount === 0
            ? undefined
            : `${attendance.courseCount} course${attendance.courseCount === 1 ? "" : "s"}`
        }
      />
      {attendance.courses.length === 0 ? (
        <EmptyState compact title="Not enrolled" description="No course enrolments this term." />
      ) : (
        <>
          {atRisk.length > 0 ? (
            <p className="border-b border-rule bg-danger-subtle px-4 py-2 text-2xs leading-relaxed text-danger-hover">
              {atRisk.length} course{atRisk.length === 1 ? " is" : "s are"} below the 80% intervention
              threshold. Contact your instructor before the next session.
            </p>
          ) : null}
          <ul className="divide-y divide-rule">
            {worst.map((course) => (
              <li key={course.sectionId} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <CourseChip code={course.courseCode} />
                  <span className="font-mono text-xs tabular-nums text-ink">
                    {course.rate === null ? "—" : `${Math.round(course.rate)}%`}
                  </span>
                </div>
                <p className="mt-1 truncate text-2xs text-ink-muted">{course.courseTitle}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function NoticesPanel({
  notices,
}: {
  notices: { id: string; title: string; body: string; courseCode: string | null; publishedAt: Date; audience: string }[];
}) {
  return (
    <Panel as="section" aria-labelledby="recent-notices">
      <PanelHeader
        id="recent-notices"
        title="Recent notices"
        actions={
          <a
            href="/announcements"
            className="text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            All
          </a>
        }
      />
      {notices.length === 0 ? (
        <EmptyState compact title="No notices" description="Institute notices will appear here." />
      ) : (
        <ul className="divide-y divide-rule">
          {notices.map((notice) => (
            <li key={notice.id} className="px-4 py-2.5">
              <div className="flex items-baseline gap-2">
                {notice.courseCode ? <CourseChip code={notice.courseCode} /> : null}
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                  {notice.title}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-ink-muted">
                {notice.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MessagesPanel({
  threads,
}: {
  threads: { id: string; subject: string; unreadCount: number; lastMessage: { senderName: string } | null; participants: { initials: string; avatarHue: number; isSelf: boolean }[] }[];
}) {
  return (
    <Panel as="section" aria-labelledby="unread-mail">
      <PanelHeader
        id="unread-mail"
        title="Unread mail"
        actions={
          <a
            href="/messages"
            className="text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            All
          </a>
        }
      />
      {threads.length === 0 ? (
        <EmptyState compact title="Nothing unread" description="You are caught up on mail." />
      ) : (
        <ul className="divide-y divide-rule">
          {threads.map((thread) => {
            const other = thread.participants.find((participant) => !participant.isSelf);
            return (
              <li key={thread.id} className="flex items-start gap-2.5 px-4 py-2.5">
                {other ? (
                  <Avatar initials={other.initials} hue={other.avatarHue} size="sm" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-ink">
                    {thread.subject}
                  </span>
                  <span className="mt-0.5 block truncate text-2xs text-ink-muted">
                    {thread.lastMessage?.senderName}
                    {thread.unreadCount > 0 ? ` · ${thread.unreadCount} new` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
