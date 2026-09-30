"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Dialog and bottom sheet.
 *
 * Hand-rolled rather than using a library, because a modal is a short list of
 * behaviours that must be exactly right, and a library that gets one of them
 * subtly wrong is worse than no library:
 *
 *  1. **Focus moves in** on open and is **restored** to the trigger on close.
 *  2. **Tab is trapped.** Not "soft-trapped" — background content is
 *     `inert`, so it cannot be reached by Tab, by a screen reader's virtual
 *     cursor, or by a programmatic focus call.
 *  3. **Escape closes.** Always, including while a nested menu is open, which is
 *     handled by only the topmost layer listening.
 *  4. **Background scroll is locked** without the layout shifting, which is why
 *     the scrollbar width is measured and compensated.
 *  5. **The dialog is labelled** by its own heading, via `aria-labelledby`.
 *
 * The `inert` attribute is doing the real work in (2). `aria-hidden` alone is
 * the classic mistake: it hides content from assistive technology while leaving
 * it focusable and clickable, which strands keyboard users on the wrong side of
 * the overlay.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Marks the portaled root of an open overlay. */
const OVERLAY_ROOT = "data-sf-overlay";

/**
 * Stack of currently-open overlay roots, innermost last.
 *
 * A stack rather than a boolean, so a confirmation dialog opened from inside
 * another dialog does not make the first one inert — which would strand focus
 * in a hidden subtree.
 */
const overlayStack: HTMLElement[] = [];

/** Everything in the document that is not part of an open overlay. */
function applyInert(): void {
  const roots = new Set<HTMLElement>(overlayStack);
  for (const child of Array.from(document.body.children)) {
    if (child instanceof HTMLElement) {
      child.inert = !roots.has(child);
    }
  }
}

function releaseOverlay(root: HTMLElement | null): void {
  const index = root ? overlayStack.indexOf(root) : -1;
  if (index !== -1) overlayStack.splice(index, 1);
  if (typeof document !== "undefined") applyInert();
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // Escape. Registered on `document` in the capture phase so a nested popover's
  // own handler runs first and can stop propagation to claim the key.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  // Lock background scroll, mark it inert, and remember what had focus.
  useEffect(() => {
    if (!open) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    const { body, documentElement } = document;
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    const previous = {
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };

    body.style.overflow = "hidden";
    // Compensating for the removed scrollbar stops the whole page shifting
    // sideways by ~15px the moment the dialog opens.
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    // Focus the first meaningful control, falling back to the panel itself so a
    // dialog with no inputs is still reachable and dismissible by keyboard.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus({ preventScroll: true });
    });

    // The portal root exists by the time effects run, so the current dialog is
    // correctly identified as "not background" when inert is applied.
    const root = panelRef.current?.closest<HTMLElement>(`[${OVERLAY_ROOT}]`);
    if (root) {
      overlayStack.push(root);
      applyInert();
    }

    return () => {
      cancelAnimationFrame(raf);
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
      releaseOverlay(root ?? null);
      restoreFocusTo.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // Keep Tab inside the panel, for the case where `inert` is not supported.
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
    );
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open || typeof document === "undefined") return null;

  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[size];

  return createPortal(
    <div
      {...{ [OVERLAY_ROOT]: "" }}
      className="fixed inset-0 z-100 flex items-end justify-center sm:items-center sm:p-6"
    >
      {/* Scrim. `onClick` on the backdrop, not the panel, so a click that starts
          inside the dialog and ends outside does not close it. */}
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="scrim absolute inset-0 cursor-default bg-ink/35 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? "dialog-description" : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden border border-rule-strong bg-surface shadow-xl outline-none",
          "animate-[dialog-in_var(--dur-base)_var(--curv-out-quint)_both] rounded-t-xl sm:rounded-lg",
          widths,
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-4 py-3.5">
          <div className="min-w-0">
            <h2 id="dialog-title" className="text-md font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id="dialog-description" className="mt-1 text-sm leading-snug text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm text-ink-subtle transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <path
                d="M1 1L12 12M12 1L1 12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-well px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A popover anchored to a trigger.
 *
 * Positioned with CSS rather than a layout engine, which is enough for the two
 * cases in this app: the notification list and the user menu. Both are anchored
 * to the top-right corner of a known-positioned element.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  align = "end",
  className,
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cn(
        "fixed z-90 mt-2 max-h-[70dvh] overflow-y-auto overscroll-contain",
        "rounded-lg border border-rule-strong bg-surface shadow-xl",
        "animate-[pop-in_var(--dur-fast)_var(--curv-out-quint)_both]",
        align === "end" ? "right-3" : "left-3",
        className,
      )}
      style={offsetFromAnchor(anchorRef.current, align)}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Place the popover under its trigger, clamped to the viewport. */
function offsetFromAnchor(
  anchor: HTMLElement | null,
  align: "start" | "end",
): React.CSSProperties {
  if (!anchor) return { top: 56, right: 12 };
  const rect = anchor.getBoundingClientRect();
  return {
    top: rect.bottom + 8,
    ...(align === "end"
      ? { right: Math.max(12, window.innerWidth - rect.right) }
      : { left: Math.max(12, rect.left) }),
  };
}
