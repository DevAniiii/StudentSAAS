"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { cn } from "@/lib/cn";
import { NAV_GROUPS, isNavItemActive, type NavItem } from "@/lib/nav";
import { DURATION, EASE } from "@/animations/tokens";
import { useReducedMotion } from "@/animations/reduced-motion";
import { BrandMark } from "./brand-mark";

/**
 * Navigation.
 *
 * Three renderings from one list, because three separate nav components would
 * inevitably disagree about which item is active or what a badge counts:
 *
 *  - the persistent desktop sidebar
 *  - the mobile drawer, which is a modal dialog and traps focus
 *  - the command palette, which reads the same `NAV_GROUPS` (see
 *    `command-palette.tsx`)
 *
 * The active item is marked **three** ways, not one. Colour alone fails for a
 * reader with a colour vision deficiency, and position alone fails in a drawer
 * that is far from the item it came from. So the link takes `aria-current`, a
 * tinted background, and a single ochre bar — the *rail* — travels to whichever
 * item is current. The bar is one element animated between positions rather than
 * nine elements appearing, which is what makes it read as one continuous
 * selection instead of a blinking light.
 *
 * Icons are drawn on a 16×16 grid at 1.3 stroke. Eleven glyphs do not justify an
 * icon dependency or a font request, and hand-drawn shapes can be tuned to stay
 * distinguishable at 16px — they differ in silhouette, not in detail.
 */

export interface NavCounts {
  unreadMessages: number;
  unreadNotifications: number;
  dueSoon: number;
}

function badgeValue(item: NavItem, counts: NavCounts): number {
  switch (item.badge) {
    case "unread-messages":
      return counts.unreadMessages;
    case "unread-notifications":
      return counts.unreadNotifications;
    case "due-soon":
      return counts.dueSoon;
    default:
      return 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Glyphs                                                                      */
/* -------------------------------------------------------------------------- */

function Glyph({ name, active }: { name: string; active: boolean }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    className: "shrink-0",
    "aria-hidden": true,
  } as const;
  const s = { stroke: "currentColor", strokeWidth: 1.3 } as const;

  switch (name) {
    // A calendar with today filled in.
    case "Today":
      return (
        <svg {...common}>
          <rect x="2" y="3.25" width="12" height="10.5" rx="1.6" {...s} />
          <path d="M2 6.4h12M5.4 1.9v2.6M10.6 1.9v2.6" {...s} strokeLinecap="round" />
          <circle cx={active ? 5.8 : 8} cy="9.4" r="1.15" fill="currentColor" />
          {active ? (
            <circle cx="10.2" cy="9.4" r="1.15" fill="currentColor" opacity="0.3" />
          ) : null}
        </svg>
      );

    // A register: a bound book with ruled entries.
    case "Term":
      return (
        <svg {...common}>
          <path
            d="M3.4 2.4h7.2a1.8 1.8 0 0 1 1.8 1.8v9.4H3.4z"
            {...s}
            strokeLinejoin="round"
          />
          <path d="M3.4 13.6h9" {...s} strokeLinecap="round" />
          <path
            d="M5.9 5.6h4.4M5.9 8h4.4M5.9 10.4h2.6"
            {...s}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        </svg>
      );

    // A submitted brief with a check.
    case "Work":
      return (
        <svg {...common}>
          <path d="M3.6 2.6h8.8v10.8H3.6z" {...s} strokeLinejoin="round" />
          <path d="M6 2.6V1.5h4v1.1" {...s} strokeLinejoin="round" />
          <path
            d="m5.9 9.4 1.5 1.5 2.9-3"
            {...s}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // Ascending bars. Grades, presented as a mark scheme rather than a chart.
    case "Grades":
      return (
        <svg {...common}>
          <path
            d="M2.4 13.2V7.4M6.1 13.2V3.2M9.8 13.2V8.9M13.5 13.2V5.1"
            {...s}
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        </svg>
      );

    // A register cell with a tick.
    case "Attend.":
      return (
        <svg {...common}>
          <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.6" {...s} />
          <path
            d="m5.4 8.4 1.7 1.7 3.5-3.8"
            {...s}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // A card with a coin.
    case "Finance":
      return (
        <svg {...common}>
          <rect x="1.7" y="4.1" width="12.6" height="7.8" rx="1.6" {...s} />
          <circle cx="8" cy="8" r="2" {...s} />
          <path d="M4 4.1V2.8M12 4.1V2.8" {...s} strokeLinecap="round" />
        </svg>
      );

    // An envelope with a reply tail.
    case "Messages":
      return (
        <svg {...common}>
          <path
            d="M2.2 4.3a1.7 1.7 0 0 1 1.7-1.7h8.2a1.7 1.7 0 0 1 1.7 1.7v5.9a1.7 1.7 0 0 1-1.7 1.7H6.3l-2.8 2.4v-2.4h-.3z"
            {...s}
            strokeLinejoin="round"
          />
        </svg>
      );

    // A bell.
    case "Notices":
      return (
        <svg {...common}>
          <path
            d="M3.1 6.1a4.9 4.9 0 0 1 9.8 0c0 2.9 1 3.9 1 3.9H2.1s1-1 1-3.9Z"
            {...s}
            strokeLinejoin="round"
          />
          <path d="M6.6 12.3a1.6 1.6 0 0 0 2.8 0" {...s} strokeLinecap="round" />
        </svg>
      );

    // A wheel with a hub.
    case "Settings":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.1" {...s} />
          <path
            d="M8 1.9v1.5M8 12.6v1.5M14.1 8h-1.5M3.4 8H1.9M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1M12.3 12.3l-1.1-1.1M4.8 4.8 3.7 3.7"
            {...s}
            strokeLinecap="round"
          />
        </svg>
      );

    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="3" {...s} />
        </svg>
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Links                                                                       */
/* -------------------------------------------------------------------------- */

function NavLink({
  item,
  active,
  count,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  count: number;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md py-2 pl-3 pr-2.5 text-sm",
        "transition-[background-color,color] duration-fast ease-out-quint",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        active
          ? "bg-accent-subtle font-semibold text-accent"
          : "text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      <Glyph name={item.short} active={active} />

      <span className="min-w-0 flex-1 truncate">{item.label}</span>

      {count > 0 ? (
        <span className="shrink-0 rounded-pill bg-ochre-subtle px-1.5 py-px font-mono text-2xs font-semibold tabular-nums text-ochre-hover">
          {count > 99 ? "99+" : count}
          <span className="sr-only"> need attention</span>
        </span>
      ) : null}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* The travelling rail                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One element, positioned between active items.
 *
 * `useLayoutEffect` rather than `useEffect`, so the first placement lands before
 * paint — otherwise the rail renders at `height: 0` for a frame and the active
 * item appears to flash.
 *
 * Geometry: the rail is `position: absolute` against the `relative` wrapper
 * below, and the active link's `offsetTop`/`offsetHeight` are measured from that
 * same wrapper. Both are read in the same frame, so there is no chance of
 * measuring against a stale layout.
 *
 * `overwrite: "auto"` so a fast sequence of navigations retargets the existing
 * tween rather than queueing conflicting ones — the bar should follow the route,
 * not lag two routes behind it.
 */
function Rail({
  containerRef,
  pathname,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  pathname: string;
}) {
  const railRef = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const rail = railRef.current;
    if (!container || !rail) return;

    const active = container.querySelector<HTMLElement>('[aria-current="page"]');

    if (!active) {
      // No active destination — an error page, or a route outside the nav. Collapse
      // the rail rather than leaving it parked under a stale item.
      gsap.to(rail, {
        height: 0,
        duration: DURATION.fast,
        ease: EASE.outQuint,
        overwrite: "auto",
      });
      return;
    }

    const y = active.offsetTop + active.offsetHeight / 2;
    const height = Math.max(active.offsetHeight - 8, 0);

    if (reduced) {
      gsap.set(rail, { y, height });
      return;
    }

    gsap.to(rail, {
      y,
      height,
      duration: DURATION.slow,
      ease: EASE.ledger,
      overwrite: "auto",
    });
    // `containerRef` is in the list because the effect reads `containerRef.current`
    // and the lint rule is right to insist. Its *identity* is stable for the
    // life of the component, so listing it costs nothing; what it does not do is
    // make the effect re-run when `.current` is repointed, which is why the
    // re-measure below exists as a separate effect.
  }, [pathname, reduced, containerRef]);

  // Group labels and link heights change with the density setting and on font
  // load, so re-measure rather than trusting a placement computed at mount.
  useEffect(() => {
    const rail = railRef.current;
    const container = containerRef.current;
    if (!rail || !container) return;

    let frame = 0;
    const remeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = container.querySelector<HTMLElement>('[aria-current="page"]');
        if (!active) return;
        gsap.set(rail, {
          y: active.offsetTop + active.offsetHeight / 2,
          height: Math.max(active.offsetHeight - 8, 0),
        });
      });
    };

    window.addEventListener("resize", remeasure);
    document.fonts?.ready.then(remeasure).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", remeasure);
    };
  }, [containerRef]);

  return <span ref={railRef} className="nav-rail" aria-hidden />;
}

/* -------------------------------------------------------------------------- */
/* Rail                                                                        */
/* -------------------------------------------------------------------------- */

export function NavRail({
  counts,
  onNavigate,
  className,
}: {
  counts: NavCounts;
  /** Called after a link is followed, so the drawer can close itself. */
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  // The rail is measured against this element, so it is the rail's containing
  // block and the source of its `offsetTop` values at the same time.
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* A sibling of `<nav>` rather than a child: absolutely positioned against
          the wrapper, so it spans the whole list instead of being clipped by a
          group's box. */}
      <Rail containerRef={containerRef} pathname={pathname} />
      <nav aria-label="Primary">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="px-3 pb-4 last:pb-2">
            <p className="px-3 pb-1.5 pt-3 font-mono text-2xs uppercase tracking-[0.15em] text-ink-subtle">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    active={isNavItemActive(item, pathname)}
                    count={badgeValue(item, counts)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile drawer                                                               */
/* -------------------------------------------------------------------------- */

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The mobile drawer.
 *
 * A real modal dialog: focus moves in and is restored on close, Tab is trapped,
 * Escape closes, and background scroll is locked. A drawer that is merely
 * `position: fixed` leaves keyboard users tabbing invisibly through the page
 * behind it, which is the most common way a mobile nav fails.
 *
 * Closes on navigation too, which is the case everyone forgets: the link is
 * followed, the route changes, and the drawer is still open over the new page.
 */
export function NavDrawer({
  open,
  onClose,
  counts,
}: {
  open: boolean;
  onClose: () => void;
  counts: NavCounts;
}) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const lastPath = useRef(pathname);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      onClose();
    }
  }, [pathname, onClose]);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel)?.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [
        ...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
      ];
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return (
    <div className="fixed inset-0 z-100 lg:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        tabIndex={-1}
        onClick={onClose}
        className="scrim absolute inset-0 cursor-default bg-ink/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-[16.5rem] max-w-[85vw] flex-col border-r border-rule-strong bg-surface shadow-xl outline-none animate-[drawer-enter-left_var(--dur-slower)_var(--curv-out-quint)_both]"
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <BrandMark size="sm" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid size-7 place-items-center rounded-sm text-ink-subtle transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M1 1L11 11M11 1L1 11"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          <NavRail counts={counts} onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}

/** The nav list itself, exposed for tests and for the sitemap. */
export function NavGroupList({ className }: { className?: string }): ReactNode {
  return (
    <ul className={cn("space-y-1", className)}>
      {NAV_GROUPS.flatMap((group) => group.items).map((item) => (
        <li key={item.href}>
          <Link href={item.href} className="text-sm text-accent underline-offset-2 hover:underline">
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
