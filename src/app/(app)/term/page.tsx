import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getShellContext } from "@/server/context";
import { getSections } from "@/server/academic";
import { PageHeader } from "@/components/ui/panel";
import { TermBoard } from "@/components/pages/term-board";

export const metadata: Metadata = { title: "Term" };

/**
 * Term.
 *
 * The reference screen: timetable, course cards, contact details, and the shape
 * of the term. Everything here is read rather than acted on, so it is built for
 * scanning — a weekly grid that answers "when and where" without scrolling, and
 * cards that answer "what am I taking and who do I ask".
 *
 * The timetable is rendered as a real `<table>` with a row per weekday. Not a
 * grid of absolutely-positioned divs: a student printing this page to carry
 * around should get a legible timetable, and a screen reader should be able to
 * announce "Monday, three classes, first at nine" rather than reading 200 empty
 * boxes in order.
 *
 * The term id is passed down to `getSections` rather than left for it to infer.
 * Without it the query has to work out which term each course belongs to and
 * issue a second round trip to find out — and the answer is already sitting in
 * the shell context this page has just resolved. The database is hosted a long
 * way from the reader, so a round trip is the most expensive thing on the page.
 */

export default async function TermPage() {
  const context = await getShellContext();
  if (!context) redirect("/login");

  const sections = await getSections(context.user.id, context.term?.id);

  return (
    <>
      <PageHeader
        eyebrow={context.term ? context.term.code : undefined}
        title="Term"
        description={
          context.term
            ? `${context.term.name} · ${formatRange(context.term.startsOn, context.term.endsOn, context.timezone)}`
            : "No term is currently published."
        }
      />

      <TermBoard
        sections={sections}
        term={context.term}
        timezone={context.timezone}
        now={context.now}
        weekStartsOn={context.preferences.weekStartsOn}
      />
    </>
  );
}

function formatRange(start: Date, end: Date, timezone: string): string {
  const month = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: timezone }).format(date);
  const day = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: timezone }).format(date);
  const sameMonth =
    new Intl.DateTimeFormat("en-GB", { month: "numeric", timeZone: timezone }).format(start) ===
    new Intl.DateTimeFormat("en-GB", { month: "numeric", timeZone: timezone }).format(end);

  return sameMonth
    ? `${day(start)} – ${day(end)} ${month(end)}`
    : `${day(start)} ${month(start)} – ${day(end)} ${month(end)}`;
}
