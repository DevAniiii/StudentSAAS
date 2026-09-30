"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { cn } from "@/lib/cn";

/**
 * The assignment filter.
 *
 * Five chips, each carrying the number of items behind it. Two decisions worth
 * explaining:
 *
 * 1. **The counts come from the unfiltered set**, so the chip you are *not*
 *    looking at still tells you whether it is worth switching to. A filter row
 *    whose counts only reflect the current filter collapses to "you have zero"
 *    everywhere the moment you filter to something narrow, which teaches people
 *    not to trust it.
 *
 * 2. **The filter lives in the URL.** Navigating with `router.push` rather than
 *    `router.replace` is deliberate: the back button must undo a filter change,
 *    because students change their minds about what they are looking at and
 *    expect Back to work.
 *
 * Rendered as a tablist rather than a group of buttons. The screens are
 * parallel views of one list, which is what a tablist means, and it gives the
 * arrow-key behaviour for free in most readers. Links are used underneath so
 * every filter is middle-clickable and openable in a new tab — a real advantage
 * over `role="tab"` buttons, which are just `<div>`s as far as the browser is
 * concerned.
 */

export interface AssignmentFilterCounts {
  open: number;
  submitted: number;
  graded: number;
  overdue: number;
  all: number;
}

const FILTERS: {
  id: keyof AssignmentFilterCounts;
  label: string;
  hint: string;
}[] = [
  { id: "open", label: "To do", hint: "Not started, in progress, or overdue" },
  { id: "overdue", label: "Overdue", hint: "Past the deadline and not submitted" },
  { id: "submitted", label: "Submitted", hint: "Handed in, awaiting a mark" },
  { id: "graded", label: "Graded", hint: "Marked and returned" },
  { id: "all", label: "Everything", hint: "Every item on every section" },
];

export function AssessmentFilterBar({
  active,
  counts,
}: {
  active: keyof AssignmentFilterCounts;
  counts: AssignmentFilterCounts;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Roving tabindex: the group is one tab stop, arrows move within it. Matches
  // the segmented control's behaviour so the two filter patterns in the product
  // feel identical.
  const onKeyDown = (event: React.KeyboardEvent<HTMLAnchorElement>) => {
    const index = FILTERS.findIndex((filter) => filter.id === active);
    let next = index;

    if (event.key === "ArrowRight") next = (index + 1) % FILTERS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + FILTERS.length) % FILTERS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FILTERS.length - 1;
    else return;

    event.preventDefault();
    const target = FILTERS[next];
    if (!target) return;
    startTransition(() => {
      router.push(target.id === "open" ? pathname : `${pathname}?filter=${target.id}`);
    });
  };

  return (
    <div
      role="tablist"
      aria-label="Filter assignments"
      aria-busy={pending}
      className={cn(
        "flex flex-wrap items-center gap-1 border-b border-rule",
        pending && "opacity-70 transition-opacity",
      )}
    >
      {FILTERS.map((filter, index) => {
        const selected = filter.id === active;
        return (
          <Link
            key={filter.id}
            href={filter.id === "open" ? pathname : `${pathname}?filter=${filter.id}`}
            scroll={false}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            ref={selected ? activeRef : undefined}
            title={filter.hint}
            onKeyDown={onKeyDown}
            onClick={(event) => {
              // Let modified clicks through so "open in new tab" still works,
              // but intercept the plain left click to keep it a client
              // navigation rather than a full document load.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              startTransition(() => {
                router.push(
                  filter.id === "open" ? pathname : `${pathname}?filter=${filter.id}`,
                );
              });
            }}
            className={cn(
              "group -mb-px flex items-baseline gap-1.5 border-b-2 px-3 py-2 text-sm",
              "transition-colors duration-fast ease-out-quint",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
              selected
                ? "border-accent font-semibold text-ink"
                : "border-transparent text-ink-muted hover:border-rule-strong hover:text-ink",
            )}
          >
            {filter.label}
            <span
              className={cn(
                "font-mono text-2xs tabular-nums",
                selected ? "text-accent" : "text-ink-subtle",
              )}
            >
              {counts[filter.id]}
            </span>
            {index === FILTERS.length - 1 ? null : <span className="sr-only">,</span>}
          </Link>
        );
      })}
    </div>
  );
}
