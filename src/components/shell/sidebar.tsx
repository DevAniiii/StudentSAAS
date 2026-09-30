"use client";

import { NavRail, type NavCounts } from "./navigation";
import { BrandMark } from "./brand-mark";

/**
 * The desktop sidebar.
 *
 * A client component because the navigation inside it is interactive — the
 * travelling rail and the mobile drawer both need to observe the pathname. That
 * is a deliberate trade: the sidebar's markup is not in the initial HTML, but
 * the trade buys a single active-item implementation shared with the drawer
 * rather than two that can drift apart.
 *
 * Three bands, top to bottom: the wordmark, the navigation, the student's own
 * record. The record sits at the bottom rather than in the topbar because the
 * topbar is a control strip and this is identity — and because a student number
 * that is only reachable by opening a menu is not really visible.
 */
export function Sidebar({
  counts,
  user,
  term,
}: {
  counts: NavCounts;
  user: {
    name: string;
    initials: string;
    hue: number;
    role: string;
    studentNumber: string | null;
    program: string | null;
  };
  term: { code: string; name: string; week: number; weekCount: number } | null;
}) {
  return (
    <aside className="app-sidebar">
      <div className="flex h-[var(--header-h)] shrink-0 items-center border-b border-rule px-4">
        <BrandMark />
      </div>

      <div data-nav-scroll className="min-h-0 flex-1 overflow-y-auto">
        <NavRail counts={counts} />
      </div>

      <div className="shrink-0 border-t border-rule px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-pill border border-rule font-semibold uppercase tracking-wide"
            style={{
              backgroundColor: `oklch(0.9 0.045 ${user.hue})`,
              color: `oklch(0.32 0.06 ${user.hue})`,
            }}
          >
            <span className="text-2xs">{user.initials}</span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-ink">{user.name}</p>
            <p className="truncate font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-subtle">
              {user.studentNumber ?? user.role.replace(/_/g, " ").toLowerCase()}
            </p>
          </div>
        </div>
        <p className="mt-2 truncate text-2xs text-ink-muted">
          {user.program ?? "Programme not recorded"}
        </p>
        {term ? (
          <p className="mt-0.5 truncate font-mono text-[0.6rem] tabular-nums text-ink-subtle">
            {term.code} · week {term.week}/{term.weekCount}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
