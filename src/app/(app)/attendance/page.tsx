import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getShellContext } from "@/server/context";
import { getAttendanceOverview } from "@/server/attendance";
import { PageHeader } from "@/components/ui/panel";
import { AttendanceBoard } from "@/components/pages/attendance-board";
import {
  EXAM_ELIGIBILITY_FLOOR,
  INTERVENTION_FLOOR,
  attendanceRate,
} from "@/lib/attendance";

export const metadata: Metadata = { title: "Attendance" };

/**
 * Attendance.
 *
 * The screen exists because attendance has a cliff edge: 80% today and 74% next
 * month can be the difference between sitting an exam and not. Every design
 * choice follows from wanting that cliff visible *before* it is reached.
 *
 * So the page leads with what is left, not with what has happened:
 *
 *  - "you can miss N more classes" is computed by simulation in
 *    `lib/attendance.ts` and shown per course, because dividing by a percentage
 *    gives the wrong answer surprisingly often
 *  - the term heat strip shows every date at a glance, so a run of absences is
 *    visible as a *shape* rather than as a count
 *  - unmarked sessions are surfaced separately, because an unmarked register is
 *    the registrar's gap, not the student's absence, and conflating the two
 *    would understate attendance without telling anyone why
 */

export default async function AttendancePage() {
  const context = await getShellContext();
  if (!context) redirect("/login");

  const overview = await getAttendanceOverview(context.user.id, context.now);
  const rate = overview.total.held > 0 ? attendanceRate(overview.total) : overview.rate;

  return (
    <>
      <PageHeader
        eyebrow={context.term ? context.term.code : undefined}
        title="Attendance"
        description={`You need ${Math.round(EXAM_ELIGIBILITY_FLOOR * 100)}% of classes to sit the exam. ${Math.round(INTERVENTION_FLOOR * 100)}% is the intervention threshold — below that, your department will contact you.`}
      />

      <AttendanceBoard
        overview={overview}
        rate={rate}
        timezone={context.timezone}
        now={context.now}
      />
    </>
  );
}
