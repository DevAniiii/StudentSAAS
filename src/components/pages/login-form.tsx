"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { TextField } from "@/components/ui/field";
import { InlineError } from "@/components/ui/states";

/**
 * The sign-in form.
 *
 * Written as a client component that talks to `/api/v1/auth/login` rather than a
 * server action, for one reason: the failure modes of a login form are the whole
 * screen. A server action that throws renders the Next.js error overlay; a
 * 401 from a route handler is just a response, and the form can stay on screen
 * with the email preserved and the password field cleared. "Wrong password" is
 * the single most common thing that happens on this page, and the design has to
 * be right for it.
 *
 * Three decisions worth stating:
 *
 *  - **The error never names the field.** "Email or password is incorrect" for
 *    both, always. Anything else is a user-enumeration oracle: it tells an
 *    attacker which addresses have accounts, and it tells a legitimate student
 *    who mistyped their address that they have a typo rather than a password
 *    problem. The message is deliberately unhelpfully broad.
 *  - **The email survives a failure; the password does not.** Nobody wants to
 *    retype an address, and nobody wants a password sitting in a DOM node after
 *    the server has rejected it.
 *  - **The submit button is disabled only while in flight**, never because a
 *    field is empty. Disabling on incomplete input removes the error message
 *    that would explain why, and makes the form feel broken. An empty form is
 *    submitted and the server answers.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm({
  reason,
  next,
  demoEmail,
}: {
  /** Why the user is here, from `?reason=`. Shown as a notice, not an error. */
  reason: string | null;
  /** Validated same-origin destination, from `?next=`. See the page. */
  next: string;
  /** Pre-filled on a dev-only build. See the page. */
  demoEmail?: string;
}) {
  const [email, setEmail] = useState(demoEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // An error means the field it refers to needs attention, so send focus there
  // rather than leaving it on the submit button. Only on a *server* rejection —
  // client-side validation focuses below, at the point of detection.
  useEffect(() => {
    if (!error) return;
    const target = /password/i.test(error) ? passwordRef.current : emailRef.current;
    target?.focus();
    target?.select();
  }, [error]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!EMAIL.test(trimmedEmail)) {
      setError("Enter the email address your institute gave you.");
      emailRef.current?.focus();
      return;
    }
    if (password.length === 0) {
      setError("Enter your password.");
      passwordRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });

      if (!response.ok) {
        setPassword("");
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;

        if (response.status === 429) {
          setError(
            payload?.error?.message ??
              "Too many attempts. Wait a few minutes before trying again.",
          );
        } else {
          setError(payload?.error?.message ?? "Email or password is incorrect.");
        }
        setBusy(false);
        return;
      }

      // A full navigation, not a client push: the server components above this
      // one all read the session, and they need to render fresh.
      window.location.assign(next);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {reason ? (
        <p
          role="status"
          className="rounded-md border border-info/25 bg-info-subtle px-3 py-2.5 text-xs leading-relaxed text-ink"
        >
          {reason}
        </p>
      ) : null}

      <TextField
        ref={emailRef}
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@college.edu"
        required
      />

      <TextField
        ref={passwordRef}
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      {/*
        Reserved, not conditional. An error appearing above a button pushes the
        button down by its own height, and the user's pointer is already on it.
      */}
      <div className="min-h-[1.5rem]" aria-live="polite">
        {error ? <InlineError>{error}</InlineError> : null}
      </div>

      <button
        type="submit"
        disabled={busy}
        className={cn(
          "inline-flex h-[var(--control-lg)] w-full items-center justify-center rounded-md",
          "bg-accent text-sm font-semibold text-accent-fg",
          "transition-colors duration-fast ease-out-quint hover:bg-accent-hover",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
