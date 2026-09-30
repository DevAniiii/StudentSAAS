"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { SelectField, Checkbox } from "@/components/ui/field";
import { Avatar } from "@/components/ui/data-display";
import { DataRow } from "@/components/ui/data-display";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/**
 * Your record, and what the portal tells you about.
 *
 * The read-only/editable split is deliberate and load-bearing.
 *
 * A student's registered name, student number and programme come from the
 * registrar's system of record. Offering an editable field that quietly does not
 * save is worse than not offering one — a student will correct a typo, see it
 * revert on the next page, and conclude the portal has lost their data. So those
 * fields are shown as values with an explanation of who to ask, not as inputs.
 *
 * Two things *are* editable here, and both are genuinely the student's:
 *
 *  - **Timezone**, which affects every date this portal shows them. Getting it
 *    wrong makes a 09:00 lecture read as 23:00 the previous day.
 *  - **Week starts on**, which is a local convention, not institutional data.
 *
 * Notification toggles control what the portal writes a notification record for.
 * They do not control email or SMS, and the copy says so — a student who
 * unticks "messages" and then misses an instructor's email has been misled.
 */

const ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** Checked against the browser's own list so the ordering matches the OS. */
function sortZones(current: string): string[] {
  let supported: string[] = [];
  try {
    const resolved = Intl.supportedValuesOf("timeZone");
    supported = resolved.filter(
      (zone) => !zone.startsWith("Etc/") && !zone.startsWith("SystemV/"),
    );
  } catch {
    supported = [];
  }
  const list = supported.length > 0 ? supported : ZONES;
  return [...new Set([...list, current])].sort((a, b) =>
    a === current ? -1 : b === current ? 1 : a.localeCompare(b),
  );
}

export function AccountPanel({
  user,
  preferences,
  effectiveTimezone,
}: {
  user: {
    name: string;
    email: string;
    studentNumber: string | null;
    program: string | null;
    studyYear: number | null;
    role: string;
    initials: string;
    hue: number;
  };
  preferences: {
    weekStartsOn: number;
    timezone: string;
    notify: {
      assignmentDue: boolean;
      gradePosted: boolean;
      announcement: boolean;
      messages: boolean;
      paymentDue: boolean;
    };
  };
  effectiveTimezone: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [zones] = useState(() => sortZones(preferences.timezone));
  const [timezone, setTimezone] = useState(preferences.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState(preferences.weekStartsOn);
  const [notify, setNotify] = useState(preferences.notify);

  const save = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const response = await fetch("/api/v1/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(String(response.status));
        toast.success("Saved", "Your preferences have been updated.");
        router.refresh();
      } catch {
        toast.error(
          "Could not save",
          "Your change has not been stored. Check your connection and try again.",
        );
      }
    },
    [router, toast],
  );

  const changedTimezone = timezone !== preferences.timezone;
  const changedWeek = weekStartsOn !== preferences.weekStartsOn;
  const notifyChanged = (
    Object.keys(notify) as (keyof typeof notify)[]
  ).some((key) => notify[key] !== preferences.notify[key]);

  return (
    <>
      <Panel as="section" aria-labelledby="record">
        <PanelHeader
          id="record"
          title="Your record"
          description="Held by the registrar. Contact them to correct anything here."
        />

        <div className="flex flex-wrap items-center gap-4 border-b border-rule px-4 py-4">
          <Avatar initials={user.initials} hue={user.hue} size="lg" />
          <div className="min-w-0">
            <p className="text-md font-semibold tracking-[-0.012em] text-ink">{user.name}</p>
            <p className="mt-0.5 font-mono text-2xs text-ink-muted">{user.email}</p>
          </div>
        </div>

        <dl>
          <DataRow label="Student number">
            {user.studentNumber ?? (
              <span className="text-ink-subtle">Not assigned</span>
            )}
          </DataRow>
          <DataRow label="Programme">
            {user.program ?? <span className="text-ink-subtle">Not recorded</span>}
            {user.studyYear ? (
              <span className="ml-1.5 text-2xs text-ink-subtle">Year {user.studyYear}</span>
            ) : null}
          </DataRow>
          <DataRow label="Role">
            <span className="capitalize">{user.role.toLowerCase().replace(/_/g, " ")}</span>
          </DataRow>
          <DataRow label="Times shown in">
            {effectiveTimezone}
            <span className="ml-1.5 font-mono text-2xs text-ink-subtle">{offset(effectiveTimezone)}</span>
          </DataRow>
        </dl>

        <p className="border-t border-rule px-4 py-3 text-2xs leading-relaxed text-ink-subtle">
          Your name, student number and programme are read from the registrar&apos;s records and
          cannot be changed here. If one of them is wrong, the registrar&apos;s office is the only
          place it can be corrected — editing it here would put the portal out of step with the
          system of record, which is worse than showing the mistake plainly.
        </p>
      </Panel>

      <Panel as="section" aria-labelledby="local">
        <PanelHeader
          id="local"
          title="Local conventions"
          description="Affects how dates are displayed to you, and nothing else."
        />

        <div className="grid gap-x-8 gap-y-4 px-4 py-4 lg:grid-cols-2">
          <SelectField
            label="Timezone"
            name="timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            hint="Every date and time in ScholarFolio is shown in this zone. Class times do not change — how you see them does."
            options={zones.map((zone) => ({
              value: zone,
              label: `${zone} (${offset(zone)})`,
            }))}
          />

          <SelectField
            label="Week starts on"
            name="weekStartsOn"
            value={String(weekStartsOn)}
            onChange={(event) => setWeekStartsOn(Number(event.target.value))}
            hint="The order days appear in the timetable. Your institute's calendar always runs Monday to Sunday regardless."
            options={[
              { value: "1", label: "Monday" },
              { value: "0", label: "Sunday" },
              { value: "6", label: "Saturday" },
            ]}
          />
        </div>

        {changedTimezone || changedWeek ? (
          <div className="flex items-center justify-end gap-2 border-t border-rule px-4 py-2.5">
            <button
              type="button"
              onClick={() => {
                setTimezone(preferences.timezone);
                setWeekStartsOn(preferences.weekStartsOn);
              }}
              className="rounded-md px-3 py-1.5 text-xs text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void save({ timezone, weekStartsOn })}
              className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg transition-colors duration-fast hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Save conventions
            </button>
          </div>
        ) : null}
      </Panel>

      <Panel as="section" aria-labelledby="notify">
        <PanelHeader
          id="notify"
          title="Notifications"
          description="What ScholarFolio records a notification for. These do not control email or text messages."
        />

        <div className="grid gap-x-8 gap-y-3 px-4 py-4 sm:grid-cols-2">
          <Checkbox
            label="Deadlines approaching"
            description="When an assessment is due within three days and not yet submitted."
            checked={notify.assignmentDue}
            onChange={(event) => setNotify({ ...notify, assignmentDue: event.target.checked })}
          />
          <Checkbox
            label="Results posted"
            description="When a grade is released for work you submitted."
            checked={notify.gradePosted}
            onChange={(event) => setNotify({ ...notify, gradePosted: event.target.checked })}
          />
          <Checkbox
            label="Announcements"
            description="When a notice is published for your courses or programme."
            checked={notify.announcement}
            onChange={(event) => setNotify({ ...notify, announcement: event.target.checked })}
          />
          <Checkbox
            label="New messages"
            description="When an instructor starts or replies to a thread."
            checked={notify.messages}
            onChange={(event) => setNotify({ ...notify, messages: event.target.checked })}
          />
          <Checkbox
            label="Payments and overdue balances"
            description="When an invoice is issued, or passes its due date unpaid."
            checked={notify.paymentDue}
            onChange={(event) => setNotify({ ...notify, paymentDue: event.target.checked })}
          />
        </div>

        <p className="border-t border-rule px-4 py-3 text-2xs leading-relaxed text-ink-subtle">
          Turning one of these off stops the portal recording a notification and stops the red count
          in the topbar. It does not stop your instructor emailing you, and it does not stop a
          deadline from passing — only you can do that.
        </p>

        {notifyChanged ? (
          <div className="flex items-center justify-end gap-2 border-t border-rule px-4 py-2.5">
            <button
              type="button"
              onClick={() => setNotify(preferences.notify)}
              className="rounded-md px-3 py-1.5 text-xs text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void save({ notify })}
              className={cn(
                "rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg",
                "transition-colors duration-fast hover:bg-accent-hover",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
            >
              Save notification settings
            </button>
          </div>
        ) : null}
      </Panel>
    </>
  );
}

/** `+01:00` for the current offset in a zone, at this moment. */
function offset(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "UTC";
  } catch {
    return "UTC";
  }
}
