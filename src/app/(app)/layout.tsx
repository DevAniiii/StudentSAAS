import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getShellContext } from "@/server/context";
import { getNotifications } from "@/server/comms";
import { MotionProvider } from "@/animations/motion-provider";
import { ShellProviders } from "@/components/shell/providers";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import type { ThemeSetting } from "@/components/shell/theme";

/**
 * The authenticated shell.
 *
 * Everything below this layout assumes a signed-in student, so the session is
 * resolved once here rather than in each page. A page that renders without a
 * session is a bug; redirecting in the layout makes it structurally impossible.
 *
 * The gate is a redirect rather than a 401, because this is a page request and a
 * page that answers "unauthorized" is a page the browser renders as a page. The
 * API routes under `/api/v1` run the same check and answer with JSON.
 *
 * A signed-in student reaching `/login` is redirected the other way, in
 * `src/app/login/page.tsx`.
 */

export const metadata: Metadata = {
  title: { default: "ScholarFolio", template: "%s · ScholarFolio" },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getShellContext();
  if (!context) redirect("/login");

  const notifications = await getNotifications(context.user.id, 30);

  return (
    <ShellProviders
      initialTheme={context.preferences.theme as ThemeSetting}
      initialDensity={context.preferences.density}
    >
      <MotionProvider>
        <div className="app-shell">
          <Sidebar
            counts={context.counts}
            user={{
              name: context.user.fullName,
              initials: context.user.initials,
              hue: context.user.avatarHue,
              role: context.user.role,
              studentNumber: context.user.studentNumber,
              program: context.user.programName,
            }}
            term={context.term}
          />

          <div className="flex min-w-0 flex-col">
            <Topbar
              counts={context.counts}
              term={context.term}
              user={{
                name: context.user.fullName,
                initials: context.user.initials,
                hue: context.user.avatarHue,
                role: context.user.role,
                email: context.user.email,
              }}
              notifications={notifications.map((notification) => ({
                id: notification.id,
                kind: notification.kind as string,
                title: notification.title,
                body: notification.body,
                href: notification.href,
                // Dates do not survive the RSC boundary, so the client shell
                // receives ISO strings and parses them where it renders.
                readAt: notification.readAt?.toISOString() ?? null,
                createdAt: notification.createdAt.toISOString(),
              }))}
              now={context.now.toISOString()}
            />

            {/* `tabIndex={-1}` so the skip link has something to focus. Without
                it the link moves the viewport but focus stays on the nav, and the
                next Tab press returns to the sidebar. */}
            <main id="main" className="canvas" tabIndex={-1}>
              {children}
            </main>
          </div>
        </div>
      </MotionProvider>
    </ShellProviders>
  );
}
