"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TextField } from "@/components/ui/field";
import { InlineError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

/**
 * Security.
 *
 * Two things, and they are the only two things a student can do about their own
 * security in a portal: change their password, and see where they are signed in.
 *
 * Both are treated as consequential rather than routine.
 *
 * **Password change** demands the current password, not just the new one. Without
 * that check, anyone who walks up to an unlocked laptop can take over the
 * account, and "someone changed my password" is not a recoverable position. On
 * success every *other* session is destroyed, because the realistic reason to
 * change a password is that you think it has leaked, and leaving the leaked
 * session alive would defeat the change. The device you changed it on stays
 * signed in, which is the one thing that would otherwise force an immediate
 * re-login and read as a failure.
 *
 * **Active sessions** are listed by device, derived honestly from the user agent
 * — parsed, not merely truncated, so "Chrome on Windows" rather than
 * "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537". An unrecognised
 * agent says so instead of guessing. "Sign out everywhere" is one click and
 * always available, and after it the page is reloaded rather than patched,
 * because the honest state after "sign out everywhere" is that you are signed
 * out.
 */

interface SessionRow {
  id: string;
  label: string;
  raw: string | null;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
}

export function SessionPanel({
  sessions,
  email,
  policy,
}: {
  sessions: SessionRow[];
  email: string;
  policy: { maxAgeDays: number; idleDays: number };
}) {
  const router = useRouter();
  const toast = useToast();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const changePassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setErrors({});
      setFormError(null);

      const nextErrors: Record<string, string> = {};
      if (next.length === 0) nextErrors.next = "Choose a new password.";
      else if (next.length < 10)
        nextErrors.next = "Use at least 10 characters. Length does more than symbols.";
      else if (!/[0-9]/.test(next) && !/[^A-Za-z0-9]/.test(next))
        nextErrors.next = "Add a number or a symbol.";
      if (confirm.length === 0) nextErrors.confirm = "Type the new password again.";
      else if (next !== confirm) nextErrors.confirm = "The two passwords do not match.";

      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      setChanging(true);
      try {
        const response = await fetch("/api/v1/auth/password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ currentPassword: current, newPassword: next }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: { message?: string; fields?: { path: string; message: string }[] };
          } | null;

          const fields: Record<string, string> = {};
          for (const field of payload?.error?.fields ?? []) fields[field.path] = field.message;
          if (Object.keys(fields).length > 0) setErrors(fields);
          setFormError(
            payload?.error?.message ?? `The password was not changed (${response.status}).`,
          );
          setChanging(false);
          return;
        }

        setCurrent("");
        setNext("");
        setConfirm("");
        toast.success(
          "Password changed",
          "Every other signed-in device has been signed out. This one stays.",
        );
        router.refresh();
      } catch {
        setFormError("Could not reach the server. Your password has not been changed.");
      } finally {
        setChanging(false);
      }
    },
    [confirm, current, next, router, toast],
  );

  const signOutEverywhere = useCallback(async () => {
    setSigningOut(true);
    try {
      const response = await fetch("/api/v1/auth/sessions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!response.ok) throw new Error(String(response.status));
      // A full navigation, not a client transition: after this there is no
      // session, and rendering the shell optimistically would show a signed-in
      // UI over a dead cookie.
      window.location.assign("/login?reason=signed-out");
    } catch {
      setSigningOut(false);
      setConfirmSignOut(false);
      toast.error(
        "Could not sign out",
        "Nothing has been changed. Your sessions are still active — try again.",
      );
    }
  }, [toast]);

  const signOutOne = useCallback(
    async (id: string) => {
      try {
        const response = await fetch("/api/v1/auth/sessions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ all: false, sessionId: id }),
        });
        if (!response.ok) throw new Error(String(response.status));
        toast.success("Session signed out", "That device has been signed out.");
        router.refresh();
      } catch {
        toast.error(
          "Could not sign that device out",
          "The session is still active. Try again in a moment.",
        );
      }
    },
    [router, toast],
  );

  return (
    <div className="space-y-5">
      <Panel as="section" aria-labelledby="sessions">
        <PanelHeader
          id="sessions"
          title="Where you are signed in"
          description={`Each session ends after ${policy.idleDays} days without activity, and in any case after ${policy.maxAgeDays} days.`}
          actions={
            sessions.length > 1 ? (
              confirmSignOut ? (
                <span className="flex items-center gap-2">
                  <span className="text-2xs text-ink-muted">
                    Sign out {sessions.length - 1} other{sessions.length === 2 ? "" : "s"}?
                  </span>
                  <button
                    type="button"
                    onClick={() => void signOutEverywhere()}
                    disabled={signingOut}
                    className="rounded-sm bg-danger px-2 py-1 text-2xs font-semibold text-ink-inverse transition-colors duration-fast hover:bg-danger-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-60"
                  >
                    {signingOut ? "Signing out…" : "Confirm"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmSignOut(false)}
                    className="rounded-sm px-1.5 py-1 text-2xs text-ink-muted underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmSignOut(true)}
                  className="rounded-md border border-rule-strong px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-fast hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Sign out everywhere
                </button>
              )
            ) : undefined
          }
        />

        <ul className="divide-y divide-rule">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3"
            >
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex items-center gap-2 text-sm text-ink">
                  <span className="truncate">{session.label}</span>
                  {session.current ? (
                    <span className="shrink-0 rounded-pill bg-accent-subtle px-1.5 py-px font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent">
                      This device
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 font-mono text-2xs text-ink-subtle">
                  Signed in {session.createdAt}
                  {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                </p>
                {session.raw && session.raw !== session.label ? (
                  <p className="mt-0.5 truncate font-mono text-[0.6rem] text-ink-subtle/70">
                    {session.raw}
                  </p>
                ) : null}
              </div>

              <p className="shrink-0 font-mono text-2xs tabular-nums text-ink-subtle">
                last seen {session.lastSeenAt}
              </p>

              {session.current ? (
                <span className="shrink-0 text-2xs text-ink-subtle">&mdash;</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void signOutOne(session.id)}
                  className="shrink-0 rounded-sm px-1.5 py-0.5 text-2xs font-medium text-danger-hover underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>

        <p className="border-t border-rule px-4 py-3 text-2xs leading-relaxed text-ink-subtle">
          Sessions are signed in to <span className="text-ink-muted">{email}</span>. An entry you do
          not recognise is a reason to change your password and sign out everywhere.
        </p>
      </Panel>

      <Panel as="section" aria-labelledby="password">
        <PanelHeader
          id="password"
          title="Change your password"
          description="Requires your current password. Every other device is signed out afterwards."
        />

        <form onSubmit={changePassword} noValidate className="grid gap-4 px-4 py-4">
          <div className="max-w-sm">
            <TextField
              name="currentPassword"
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              error={errors.currentPassword ?? null}
              required
            />
          </div>

          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <TextField
              name="newPassword"
              label="New password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              error={errors.newPassword ?? null}
              hint="At least 10 characters, with a number or a symbol."
              required
            />
            <TextField
              name="confirmPassword"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              error={errors.confirmPassword ?? null}
              required
            />
          </div>

          {/*
            A single strength line rather than a metered bar. A meter implies a
            score; a passphrase's strength is a function of whether it is
            unique, which no length/character heuristic can see.
          */}
          <p className="max-w-[62ch] text-2xs leading-relaxed text-ink-subtle">
            Nothing here checks your password against a list of leaked passwords — the portal
            does not send it anywhere to do so. Long and unique beats short and clever: four
            unrelated words are stronger than <code className="font-mono">P@ssw0rd!</code> and far
            easier to remember.
          </p>

          {/*
            The error region keeps its height whether or not there is an error.
            A form that grows when it fails moves the submit button, and on a
            failure the user is looking at the field they just got wrong, not at
            the button that produced it.
          */}
          <div className="min-h-[1.25rem]" aria-live="polite">
            {formError ? <InlineError>{formError}</InlineError> : null}
          </div>

          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={changing}
              className={cn(
                "inline-flex h-[var(--control-md)] items-center rounded-md bg-accent px-4",
                "text-sm font-semibold text-accent-fg",
                "transition-colors duration-fast hover:bg-accent-hover",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {changing ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
