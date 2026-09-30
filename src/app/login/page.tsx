import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { BrandMark } from "@/components/shell/brand-mark";
import { LoginForm } from "@/components/pages/login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign in.
 *
 * The one screen in the product that is not inside the shell, and it is built
 * accordingly: no sidebar, no topbar, no notifications, no page header. A signed
 * out visitor has no business seeing the furniture of a signed in session.
 *
 * The layout is a two-column spread on a wide screen — the form on the left, a
 * ruled ledger page on the right — because a sign-in screen is the first
 * impression and a lone input in the middle of a white page is the cheapest one
 * available. The right column is not decoration: it is the term ruler, the same
 * signature motif that runs through the topbar, presented at rest. It tells you
 * what the product is before you have an account.
 *
 * On a narrow screen that column is dropped rather than stacked. It is
 * atmosphere, and atmosphere below the fold on a phone is a scroll the user did
 * not ask for.
 *
 * The demo credentials appear only outside production. In production the field
 * is not rendered at all rather than rendered-and-hidden, because a credential in
 * the DOM is a credential in the DOM.
 */

const REASONS: Record<string, string> = {
  "signed-out": "You have been signed out. Sign in again to continue.",
  expired: "Your session expired after a period of inactivity.",
  "password-changed": "Your password was changed, so other devices were signed out.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  // Already signed in: go where they were going. Checked before anything is
  // rendered so a signed in student never sees the login form flash.
  const session = await getSession();
  const params = await searchParams;
  if (session) {
    redirect(safeNext(params.next));
  }

  const reason = params.reason ? REASONS[params.reason] : undefined;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      {/* The form column. */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-10 lg:border-r lg:border-rule">
        <div className="mx-auto w-full max-w-sm">
          <BrandMark size="lg" className="mb-9" />

          <h1 className="font-display text-2xl font-semibold tracking-[-0.024em] text-ink">
            Sign in
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Your coursework, grades, attendance and fees for the current term.
          </p>

          <div className="mt-7">
            <LoginForm
              reason={reason ?? null}
              next={safeNext(params.next)}
              demoEmail={env.isProd ? undefined : "anirban.banerjee@college.edu"}
            />
          </div>

          {!env.isProd ? (
            <div className="mt-7 rounded-md border border-dashed border-rule-strong bg-well px-3.5 py-3">
              <p className="font-mono text-2xs uppercase tracking-[0.12em] text-ink-subtle">
                Development build
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                A seeded account exists:{" "}
                <code className="font-mono text-ink">anirban.banerjee@college.edu</code> with the
                password <code className="font-mono text-ink">folio-demo-2026</code>. The address is
                pre-filled above; the password is not, because a pre-filled password is a habit.
              </p>
            </div>
          ) : null}

          <p className="mt-8 text-2xs leading-relaxed text-ink-subtle">
            Locked out? Your institute&apos;s IT service desk can reset your password. They cannot
            see your grade, your attendance or your messages — neither can anyone else with
            portal access.
          </p>
        </div>
      </div>

      <LoginAtmosphere />
    </main>
  );
}

/**
 * The right-hand column.
 *
 * A ledger page at rest: ruled lines, a spine, and the term ruler. It exists to
 * make the sign-in screen feel like part of the same product as the one the
 * student is about to see, and it is hidden below `lg` where there is no room for
 * atmosphere and every pixel is the form.
 *
 * All of it is `aria-hidden`. Nothing here is information — a screen-reader user
 * gains nothing from "decorative ruled page" and loses nothing by not hearing it.
 */
function LoginAtmosphere() {
  const rules = Array.from({ length: 18 }, (_, index) => index);

  return (
    <div
      aria-hidden
      className="relative hidden overflow-hidden border-rule bg-well lg:block"
    >
      {/* Ruled lines. Spacing matches the ledger's own rhythm so the page behind
          the form and the product in front of it are visibly the same object. */}
      <div className="absolute inset-0">
        {rules.map((rule) => (
          <span
            key={rule}
            className="absolute left-0 right-0 border-t border-rule"
            style={{ top: `${(rule + 1) * 2.75}rem` }}
          />
        ))}
      </div>

      {/* The spine: a heavier rule with the ledger's marginal column beside it. */}
      <div className="absolute inset-y-0 left-[4.5rem] w-px bg-ochre/30" />
      <div className="absolute inset-y-0 left-[5.25rem] w-px bg-rule" />

      <div className="absolute inset-0 flex flex-col justify-center px-[7.5rem]">
        <p className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-subtle">
          One ledger for the term
        </p>
        <p className="mt-4 max-w-[18ch] font-display text-3xl font-semibold leading-[1.15] tracking-[-0.028em] text-ink">
          Everything the term asks of you, in the order it asks.
        </p>
        <dl className="mt-10 grid max-w-md gap-x-8 gap-y-5 sm:grid-cols-2">
          {[
            ["Today", "What is next, and when it is due"],
            ["Grades", "Weighted, provisional until released"],
            ["Attendance", "How many more you can miss"],
            ["Finance", "Issued, paid, and outstanding"],
          ].map(([term, gloss]) => (
            <div key={term}>
              <dt className="font-mono text-2xs uppercase tracking-[0.14em] text-ochre-hover">
                {term}
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{gloss}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/**
 * Only same-origin absolute paths.
 *
 * `?next=` arrives from the query string and is fed to `redirect()`, so an
 * attacker-supplied `//evil.example` would be a working open redirect: a
 * student clicks a crafted login link, signs in legitimately, and lands on a
 * page that asks for their password "one more time". Rejecting anything with a
 * scheme, a host, or a leading slash pair is the whole defence, and it is
 * cheaper than any encoding trick.
 */
function safeNext(value: string | undefined): string {
  if (!value) return "/today";
  if (!value.startsWith("/")) return "/today";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/today";
  return value;
}
