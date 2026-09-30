import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getShellContext } from "@/server/context";
import { PageHeader } from "@/components/ui/panel";
import { SettingsPanel } from "@/components/pages/settings-panel";
import { AccountPanel } from "@/components/pages/account-panel";
import { SessionPanel } from "@/components/pages/session-panel";
import { getSession, listSessions } from "@/lib/auth/session";
import { describeAgentOrUnknown } from "@/lib/user-agent";
import { formatRelativeTime } from "@/lib/dates";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings.
 *
 * Four groups, ordered by how often they are used:
 *
 *  1. **Appearance** — theme and density. Changed often, instantly visible,
 *     and the only settings that affect this device *right now* rather than the
 *     account.
 *  2. **Your record** — name, programme, student number, timezone. Read-only
 *     except for the timezone, because a student's registered name and student
 *     number are the registrar's to change, and offering an editable field that
 *     silently does not save is worse than not offering it.
 *  3. **Notifications** — which events the portal tells you about.
 *  4. **Security** — password change and active sessions.
 *
 * Every preference is applied locally first and persisted second. The UI never
 * waits for the server to show a result, because the visible change *is* the
 * result; the write is a background detail whose failure is reported honestly if
 * it happens.
 */

export default async function SettingsPage() {
  const context = await getShellContext();
  if (!context) redirect("/login");

  // The session list is only needed by the security panel, so it is fetched here
  // rather than in `getShellContext` — every other page would pay for a query
  // that only settings uses. `getSession` is already resolved by the context, so
  // this is one extra read of the `sessions` table.
  const [current, sessions] = await Promise.all([
    getSession(),
    listSessions(context.user.id),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={context.user.studentNumber ?? context.user.role.toLowerCase()}
        title="Settings"
        description="How ScholarFolio looks and behaves, your record, and your account."
      />

      <div className="space-y-5">
        {/* No props: appearance lives in the theme context, which hydrates from
            the same storage the no-flash bootstrap reads. */}
        <SettingsPanel />

        <AccountPanel
          user={{
            name: context.user.fullName,
            email: context.user.email,
            studentNumber: context.user.studentNumber,
            program: context.user.programName,
            studyYear: context.user.studyYear,
            role: context.user.role,
            initials: context.user.initials,
            hue: context.user.avatarHue,
          }}
          preferences={context.preferences}
          effectiveTimezone={context.timezone}
        />

        <SessionPanel
          email={context.user.email}
          policy={{
            maxAgeDays: Math.round(env.session.maxAgeSeconds / 86_400),
            idleDays: Math.round(env.session.idleTimeoutSeconds / 86_400),
          }}
          sessions={sessions.map((session) => ({
            id: session.id,
            label: describeAgentOrUnknown(session.userAgent),
            // Kept alongside the label so a wrong guess is still auditable: the
            // row shows the parsed name and, on hover, what it was parsed from.
            raw: session.userAgent,
            current: session.id === current?.sessionId,
            createdAt: formatRelativeTime(session.createdAt, context.now, context.timezone),
            lastSeenAt: formatRelativeTime(session.lastSeenAt, context.now, context.timezone),
            ipAddress: session.ipAddress,
          }))}
        />
      </div>
    </>
  );
}
