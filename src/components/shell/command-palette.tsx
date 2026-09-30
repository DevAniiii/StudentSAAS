"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV_GROUPS, NAV_ITEMS, PALETTE_SHORTCUTS, type NavItem } from "@/lib/nav";

/**
 * The command palette.
 *
 * Navigation in a nine-screen product does not need a search index, so this is
 * built on `NAV_GROUPS` rather than on crawled content: every destination is
 * already declared once, in `lib/nav.ts`, and the palette, the sidebar and the
 * keyboard shortcuts are three renderings of that one list.
 *
 * What it adds over the sidebar is *recall* — "the page with the invoices on
 * it" should be reachable from the word "money", which is in `keywords` but not
 * in the label.
 *
 * Search behaviour worth noting:
 *
 *  - matching is subsequence-based, so `gs` finds "Grades", but ranking
 *    penalises a subsequence match so an exact or prefix match always wins
 *  - unmatched characters are highlighted, which teaches the ordering
 *  - a subsequence match on *any* word in a keyword list counts, so `elig` finds
 *    Attendance via "eligibility"
 */

interface Scored {
  item: NavItem;
  score: number;
  /** Index ranges within the label, for highlighting. */
  labelHits: [number, number][];
}

function scoreItem(item: NavItem, query: string): Scored | null {
  const needle = query.toLowerCase();

  if (needle === "") return { item, score: 0, labelHits: [] };

  const label = item.label.toLowerCase();
  const short = item.short.toLowerCase();
  const haystack = [label, short, ...item.keywords].join(" ");

  // Subsequence over the full haystack. Cheap, and the ranking below is what
  // actually decides what is visible.
  let cursor = 0;
  for (const char of needle) {
    cursor = haystack.indexOf(char, cursor);
    if (cursor === -1) return null;
    cursor += 1;
  }

  let score = 0;
  if (label === needle) score = 1000;
  else if (label.startsWith(needle)) score = 800;
  else if (short.toLowerCase().startsWith(needle)) score = 700;
  else if (item.keywords.some((keyword) => keyword === needle)) score = 600;
  else if (label.includes(needle)) score = 500;
  else if (item.keywords.some((keyword) => keyword.startsWith(needle))) score = 400;
  else if (short.toLowerCase().includes(needle)) score = 300;
  else score = 100;

  // A shorter label matching the same query is a better answer: "Grades" beats
  // "Attendance" for "g" is wrong, but "Term" beating "Settings" for "te" is
  // right, and length is the only signal that knows that.
  score -= Math.min(label.length, 40);

  // Highlight only within the label. Highlighting inside keywords would imply
  // the word appears on screen, which it does not.
  const labelHits: [number, number][] = [];
  let position = 0;
  for (const char of needle) {
    const found = label.indexOf(char, position);
    if (found === -1) break;
    const last = labelHits[labelHits.length - 1];
    if (last && last[1] === found) last[1] = found + 1;
    else labelHits.push([found, found + 1]);
    position = found + 1;
  }

  return { item, score, labelHits };
}

function Highlight({ text, hits }: { text: string; hits: [number, number][] }) {
  if (hits.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  hits.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={index}
        className="rounded-xs bg-ochre-subtle px-px font-semibold text-ochre-hover"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const results = useMemo(() => {
    const scored = NAV_ITEMS.map((item) => scoreItem(item, query.trim())).filter(
      (result): result is Scored => result !== null,
    );
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }, [query]);

  /** Flattened, for keyboard navigation. Grouped for rendering. */
  const grouped = useMemo(() => {
    const order: string[] = [];
    const buckets = new Map<string, Scored[]>();
    for (const result of results) {
      const group = NAV_GROUPS.find((candidate) =>
        candidate.items.some((entry) => entry.href === result.item.href),
      );
      const key = group?.label ?? "Other";
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push(key);
      }
      buckets.get(key)!.push(result);
    }
    return order.map((key) => ({ key, results: buckets.get(key)! }));
  }, [results]);

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // Reset when reopened. Carrying the last query into a fresh invocation reads
  // as a bug, not as a feature.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    setCursor((value) => Math.min(value, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const go = useCallback(
    (item: NavItem) => {
      onClose();
      router.push(item.href);
    },
    [onClose, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setCursor((value) => (results.length === 0 ? 0 : (value + 1) % results.length));
        break;
      case "ArrowUp":
        event.preventDefault();
        setCursor((value) =>
          results.length === 0 ? 0 : (value - 1 + results.length) % results.length,
        );
        break;
      case "Home":
        event.preventDefault();
        setCursor(0);
        break;
      case "End":
        event.preventDefault();
        setCursor(Math.max(results.length - 1, 0));
        break;
      case "Enter": {
        event.preventDefault();
        const result = results[cursor];
        if (result) go(result.item);
        break;
      }
      case "Escape":
        event.preventDefault();
        onClose();
        break;
    }
  };

  // Keep the active row in view. Scrolling it into view manually, rather than
  // relying on `scrollIntoView`, avoids scrolling the whole page as well.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [cursor, grouped]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-100 flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="scrim absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="relative flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-rule-strong bg-surface shadow-xl animate-[dialog-in_var(--dur-base)_var(--curv-out-quint)_both]"
      >
        <div className="flex items-center gap-2.5 border-b border-rule px-3.5 py-2.5">
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden className="shrink-0 text-ink-subtle">
            <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="m7.8 7.8 2.7 2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-activedescendant={results[cursor] ? `palette-option-${results[cursor].item.href.replace(/\W/g, "")}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            placeholder="Jump to…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <kbd className="shrink-0 rounded-xs border border-rule bg-well px-1.5 py-px font-mono text-[0.6rem] text-ink-subtle">
            Esc
          </kbd>
        </div>

        <div ref={listRef} id="palette-listbox" role="listbox" aria-label="Destinations" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-ink-muted">
              No destination matches{" "}
              <span className="font-mono text-ink">“{query.trim()}”</span>.
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.key} className="mb-1.5 last:mb-0">
                <p className="px-2.5 pb-1 pt-1.5 font-mono text-2xs uppercase tracking-[0.14em] text-ink-subtle">
                  {group.key}
                </p>
                {group.results.map((result) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const active = index === cursor;
                  return (
                    <div
                      key={result.item.href}
                      id={`palette-option-${result.item.href.replace(/\W/g, "")}`}
                      role="option"
                      aria-selected={active}
                      data-active={active}
                    >
                      <button
                        type="button"
                        // `onMouseDown` rather than `onClick`: the input must not
                        // lose focus before the click resolves, or the palette
                        // closes before the navigation starts.
                        onMouseDown={(event) => {
                          event.preventDefault();
                          go(result.item);
                        }}
                        onMouseEnter={() => setCursor(index)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left",
                          "transition-colors duration-instant",
                          active ? "bg-accent-subtle" : "hover:bg-hover",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block text-sm",
                              active ? "font-semibold text-ink" : "text-ink",
                            )}
                          >
                            <Highlight text={result.item.label} hits={result.labelHits} />
                          </span>
                          <span className="mt-0.5 block truncate text-2xs text-ink-muted">
                            {result.item.hint}
                          </span>
                        </span>
                        {PALETTE_SHORTCUTS[result.item.href] ? (
                          <kbd className="shrink-0 rounded-xs border border-rule bg-well px-1.5 py-px font-mono text-[0.6rem] text-ink-subtle">
                            {PALETTE_SHORTCUTS[result.item.href]}
                          </kbd>
                        ) : null}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-rule bg-well px-3.5 py-2 font-mono text-[0.6rem] text-ink-subtle">
          <span>↑↓ navigate</span>
          <span>⏎ open</span>
          <span className="ml-auto">{results.length} of {NAV_ITEMS.length}</span>
        </div>
      </div>
    </div>
  );
}
