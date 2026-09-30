"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { NAV_ITEMS } from "@/lib/nav";
import { formatRelativeTime } from "@/lib/dates";
import { LedgerSpine } from "./ledger-spine";
import { ThemeIcon, useTheme } from "./theme";
import { NavDrawer, type NavCounts } from "./navigation";
import { CommandPalette } from "./command-palette";

/**
 * The topbar.
 *
 * Carries four things and nothing else, in this order of priority:
 *
 *  1. **Where you are in the term.** The spine, always visible, always the
 *     second-largest element after the page title.
 *  2. **What needs doing.** One count, one bell, reachable in one keystroke.
 *  3. **How you get anywhere.** The palette trigger, plus `G` then a letter.
 *  4. **Who you are and how the page looks.** The account menu and the theme
 *     toggle.
 *
 * Everything that could live on a page header instead lives here only if it is
 * needed on every page. A topbar that accumulates page-specific controls is how
 * a topbar becomes a junk drawer.
 */

export interface TopbarProps {
  counts: NavCounts;
  term: {
    name: string;
    code: string;
    week: number;
    weekCount: number;
    progress: number;
    daysRemaining: number;
    isBeforeTerm: boolean;
    isAfterTerm: boolean;
  } | null;
  user: { name: string; initials: string; hue: number; role: string; email: string };
  /** Resolved on the server so the first paint already has them. */
  notifications: {
    id: string;
    kind: string;
    title: string;
    body: string;
    href: string | null;
    readAt: string | null;
    createdAt: string;
  }[];
  /**
   * The instant the page was rendered, as an ISO string.
   *
   * Passed in rather than read from `Date.now()` in the client, because the
   * component is server-rendered too: a component that calls `new Date()` during
   * render produces different relative times on the server and on the client,
   * and React reports that as a hydration mismatch.
   */
  now: string;
}

export function Topbar({ counts, term, user, notifications, now }: TopbarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spineOpen, setSpineOpen] = useState(false);
  const { resolved, toggle } = useTheme();

  const spine = useRef<HTMLButtonElement>(null);

  /* -------------------------------------------------------------- palette -- */
  useEffect(() => {
    // `G` then a letter, the convention every mainstream product shares, plus
    // the two universal accelerators. Deliberately not a single-key scheme: bare
    // letters conflict with every text input, and the two-key form is the one
    // people already know.
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (event.key === "/" && !typing) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey) {
        armed = false;
        return;
      }

      if (armed) {
        const match = NAV_ITEMS.find(
          (item) => item.short.toLowerCase().startsWith(event.key.toLowerCase()),
        );
        armed = false;
        if (match) {
          event.preventDefault();
          window.location.assign(match.href);
        }
        return;
      }

      if (event.key.toLowerCase() === "g") {
        armed = true;
        // Disarm if the second key is slow, so a stray `g` does not swallow the
        // next letter the student types.
        timer = setTimeout(() => {
          armed = false;
        }, 1200);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, []);

  /* ------------------------------------------------------- spine expanding -- */
  const onSpineClick = useCallback(() => {
    setSpineOpen((open) => !open);
  }, []);

  // Close the expanded spine on Escape, and on any navigation.
  useEffect(() => {
    if (!spineOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSpineOpen(false);
        spine.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [spineOpen]);

  return (
    <>
      <header className="topbar">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="-ml-1 grid size-9 shrink-0 place-items-center rounded-md text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:hidden"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <path
                d="M2 4h11M2 7.5h11M2 11h11"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <button
            ref={spine}
            type="button"
            onClick={onSpineClick}
            aria-expanded={spineOpen}
            aria-controls="spine-detail"
            className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors duration-fast hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="min-w-0">
              <span className="block font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">
                {term ? term.code : "No active term"}
              </span>
              <span className="block truncate text-xs font-medium text-ink">
                {term
                  ? term.isAfterTerm
                    ? `${term.name} complete`
                    : term.isBeforeTerm
                      ? `Starts in ${Math.abs(term.daysRemaining)} days`
                      : `Week ${term.week} of ${term.weekCount}`
                  : "Contact the registrar"}
              </span>
            </span>
            <LedgerSpine
              className="ml-auto w-28 shrink-0 sm:w-40 lg:w-52"
              progress={term?.progress ?? 0}
              week={term?.week ?? 0}
              weekCount={term?.weekCount ?? 1}
              notches={[]}
            />
            <svg
              width="9"
              height="6"
              viewBox="0 0 9 6"
              fill="none"
              aria-hidden
              className={cn(
                "shrink-0 text-ink-subtle transition-transform duration-base ease-out-quint",
                spineOpen && "rotate-180",
              )}
            >
              <path
                d="M1 1.5 4.5 5 8 1.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-[var(--control-sm)] items-center gap-2 rounded-md border border-rule bg-well pl-2.5 pr-1.5 text-xs text-ink-subtle transition-colors duration-fast hover:border-rule-strong hover:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:flex"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="m7.8 7.8 2.7 2.7"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <span>Search</span>
            <kbd className="rounded-xs border border-rule bg-surface px-1 py-px font-mono text-[0.6rem] tracking-wide text-ink-subtle">
              ⌘K
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open the command palette"
            className="grid size-[var(--control-sm)] place-items-center rounded-md text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.3" />
              <path d="m9.6 9.6 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>

          <NotificationBell
            notifications={notifications}
            unread={counts.unreadNotifications}
            now={new Date(now)}
          />

          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
            className="grid size-[var(--control-sm)] place-items-center rounded-md text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ThemeIcon resolved={resolved} />
          </button>

          <UserMenu user={user} />
        </div>
      </header>

      {/*
        The expanded spine. Rendered outside the header so it can span the full
        canvas width and overlap the page, and so the growing height does not
        reflow the header itself.
      */}
      <div
        id="spine-detail"
        hidden={!spineOpen}
        className={cn(
          "absolute inset-x-0 top-full z-50 border-b border-rule-strong bg-surface shadow-lg",
          spineOpen
            ? "animate-[drawer-slide-up_var(--dur-slow)_var(--curv-out-quint)_both]"
            : "",
        )}
      >
        {term ? (
          <div className="mx-auto max-w-[78rem] px-4 py-4 sm:px-6 lg:px-8">
            <LedgerSpine
              variant="full"
              progress={term.progress}
              week={term.week}
              weekCount={term.weekCount}
              termName={term.name}
              daysRemaining={term.daysRemaining}
            />
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-rule pt-3 sm:grid-cols-4">
              <Stat label="Term" value={term.code} />
              <Stat label="Week" value={`${term.week} / ${term.weekCount}`} />
              <Stat
                label="Days remaining"
                value={term.isAfterTerm ? "—" : String(term.daysRemaining)}
              />
              <Stat
                label="Needs attention"
                value={String(counts.dueSoon + counts.unreadMessages)}
                hint={counts.dueSoon + counts.unreadMessages === 0 ? "Nothing due" : undefined}
              />
            </dl>
          </div>
        ) : (
          <p className="mx-auto max-w-[78rem] px-4 py-5 text-sm text-ink-muted sm:px-6 lg:px-8">
            No term is currently configured. Your enrolments and results are unaffected —
            contact the registrar to have the academic calendar published.
          </p>
        )}
      </div>

      <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} counts={counts} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums text-ink">
        {value}
        {hint ? <span className="ml-1.5 font-sans text-2xs text-ink-subtle">{hint}</span> : null}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Notification bell                                                            */
/* -------------------------------------------------------------------------- */

const KIND_MARK: Record<string, string> = {
  ASSIGNMENT_DUE: "!",
  GRADE_POSTED: "A",
  ATTENDANCE_RISK: "!",
  PAYMENT_DUE: "$",
  ANNOUNCEMENT: "i",
  MESSAGE: "✉",
  ENROLLMENT: "+",
};

function NotificationBell({
  notifications,
  unread,
  now,
}: {
  notifications: TopbarProps["notifications"];
  unread: number;
  now: Date;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications, none unread"
        }
        aria-expanded={open}
        className="relative grid size-[var(--control-sm)] place-items-center rounded-md text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
          <path
            d="M3.2 6a4.3 4.3 0 0 1 8.6 0c0 2.6.9 3.5.9 3.5H2.3S3.2 8.6 3.2 6Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path
            d="M6.2 11.8a1.9 1.9 0 0 0 2.6 0"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 grid min-w-[1.05rem] place-items-center rounded-pill bg-danger px-1 font-mono text-[0.55rem] font-bold leading-[1.05rem] text-danger-fg"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-rule-strong bg-surface shadow-xl animate-[pop-in_var(--dur-fast)_var(--curv-out-quint)_both]"
        >
          <div className="flex items-center justify-between border-b border-rule px-3 py-2.5">
            <p className="text-xs font-semibold text-ink">Notifications</p>
            {unread > 0 ? (
              <span className="font-mono text-2xs text-ink-subtle">{unread} unread</span>
            ) : null}
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-muted">
              Nothing new. Deadlines and results will appear here.
            </p>
          ) : (
            <ul className="max-h-[26rem] overflow-y-auto divide-y divide-rule">
              {notifications.slice(0, 12).map((notification) => (
                <li key={notification.id}>
                  <NotificationRow
                    notification={notification}
                    now={now}
                    onNavigate={() => setOpen(false)}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-rule bg-well px-3 py-2">
            <Link
              href="/announcements"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              All notices
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({
  notification,
  now,
  onNavigate,
}: {
  notification: TopbarProps["notifications"][number];
  now: Date;
  onNavigate: () => void;
}) {
  const createdAt = new Date(notification.createdAt);
  const isUnread = notification.readAt === null;

  const inner = (
    <div className={cn("flex gap-2.5 px-3 py-2.5", isUnread && "bg-accent-subtle/35")}>
      <span
        aria-hidden
        className={cn(
          "mt-px grid size-5 shrink-0 place-items-center rounded-pill border font-mono text-[0.6rem] font-semibold",
          isUnread
            ? "border-accent/40 bg-accent-subtle text-accent"
            : "border-rule bg-well text-ink-subtle",
        )}
      >
        {KIND_MARK[notification.kind] ?? "·"}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-xs", isUnread ? "font-semibold text-ink" : "text-ink")}>
          {notification.title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-ink-muted">
          {notification.body}
        </p>
        <p className="mt-1 font-mono text-[0.6rem] text-ink-subtle">
          {formatRelativeTime(createdAt, now)}
          {isUnread ? " · unread" : ""}
        </p>
      </div>
    </div>
  );

  if (!notification.href) return inner;
  return (
    <Link
      href={notification.href}
      onClick={onNavigate}
      className="block transition-colors duration-fast hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      {inner}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* User menu                                                                    */
/* -------------------------------------------------------------------------- */

function UserMenu({ user }: { user: TopbarProps["user"] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative ml-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Account menu"
        aria-expanded={open}
        className="grid size-[var(--control-sm)] place-items-center rounded-pill ring-1 ring-rule transition-shadow duration-fast hover:ring-rule-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{
          backgroundColor: `oklch(0.9 0.045 ${user.hue})`,
          color: `oklch(0.32 0.06 ${user.hue})`,
        }}
      >
        <span className="text-2xs font-semibold uppercase tracking-wide">{user.initials}</span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-lg border border-rule-strong bg-surface shadow-xl animate-[pop-in_var(--dur-fast)_var(--curv-out-quint)_both]"
        >
          <div className="border-b border-rule px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
            <p className="truncate text-2xs text-ink-muted">{user.email}</p>
            <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-ink-subtle">
              {user.role.toLowerCase().replace(/_/g, " ")}
            </p>
          </div>
          <div className="p-1">
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              Print this page
            </button>
          </div>
          <div className="border-t border-rule p-1">
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await fetch("/api/v1/auth/logout", { method: "POST" });
                router.replace("/login");
                router.refresh();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-danger-hover transition-colors duration-fast hover:bg-danger-subtle focus-visible:bg-danger-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-danger"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
