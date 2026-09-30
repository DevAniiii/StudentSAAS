"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Toasts.
 *
 * Built around one decision: a toast is for a *result the student asked for*, and
 * it is never the only place that result appears. Anything important enough to
 * need acknowledging belongs in the page, changed in place. A toast that carries
 * the news is a toast the student can miss, and a missed toast for a payment that
 * failed is worse than no toast at all.
 *
 * The queue is bounded and drops the oldest when full, so a hung request that
 * retries cannot build an unreadable stack. Deduplicated by key, so five
 * simultaneous errors from the same cause produce one toast, not five.
 */

export type ToastTone = "neutral" | "good" | "warn" | "danger";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  /** Milliseconds. `null` means it waits for dismissal — for errors. */
  duration: number | null;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  push: (toast: Omit<Toast, "id" | "tone" | "duration"> & Partial<Pick<Toast, "tone" | "duration" | "id">>) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 4;

const DEFAULT_DURATIONS: Record<ToastTone, number | null> = {
  neutral: 5000,
  good: 4000,
  // Errors stay until dismissed. A message that vanishes before it is read is
  // not a confirmation, and an error is the one case where the student is
  // likely to need to act on it later.
  warn: 7000,
  danger: null,
};

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<ToastContextValue["push"]>(
    (input) => {
      const tone = input.tone ?? "neutral";
      // An explicit id doubles as a dedupe key: pushing the same id twice
      // replaces rather than duplicates, which is what you want for a repeated
      // validation failure.
      const id = input.id ?? `toast-${++counter}`;
      const duration = input.duration === undefined ? DEFAULT_DURATIONS[tone] : input.duration;

      setToasts((current) => {
        const withoutDuplicate = current.filter((toast) => toast.id !== id);
        const next = [
          ...withoutDuplicate,
          { ...input, id, tone, duration },
        ];
        return next.slice(-MAX_VISIBLE);
      });

      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);

      if (duration !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }

      return id;
    },
    [dismiss],
  );

  // Clear every timer on unmount, or a pending dismissal fires into an unmounted
  // component and React logs a state update on an unmounted tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ title, description, tone: "good" }),
      error: (title, description) => push({ title, description, tone: "danger" }),
      info: (title, description) => push({ title, description, tone: "neutral" }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a ToastProvider");
  }
  return context;
}

const TONE_STYLES: Record<ToastTone, { bar: string; icon: string }> = {
  neutral: { bar: "bg-ink-subtle", icon: "text-ink-muted" },
  good: { bar: "bg-accent", icon: "text-accent" },
  warn: { bar: "bg-ochre", icon: "text-ochre-hover" },
  danger: { bar: "bg-danger", icon: "text-danger-hover" },
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      // `role="status"` with `aria-live="polite"` so a toast never interrupts
      // whatever a screen reader is currently saying. Errors use `assertive` in
      // the toast itself, below.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-100 flex flex-col items-center gap-2 px-4 pb-4 sm:items-end sm:px-6"
    >
      <ol className="contents">
        {toasts.map((toast) => (
          <li
            key={toast.id}
            role={toast.tone === "danger" ? "alert" : "status"}
            className="pointer-events-auto w-full max-w-sm animate-[toast-in_var(--dur-slow)_var(--curv-out-quint)_both] overflow-hidden rounded-md border border-rule-strong bg-surface shadow-lg"
          >
            <div className="flex gap-3 p-3">
              {/* Tone rail. A coloured edge reads as a category without relying
                  on the background, which would clash with the paper. */}
              <span
                aria-hidden
                className={cn("mt-0.5 w-0.5 shrink-0 self-stretch rounded-pill", TONE_STYLES[toast.tone].bar)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug text-ink">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {toast.description}
                  </p>
                ) : null}
                {toast.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick();
                      onDismiss(toast.id);
                    }}
                    className="mt-2 text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {toast.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label={`Dismiss: ${toast.title}`}
                className="-mr-1 -mt-1 grid size-6 shrink-0 place-items-center rounded-sm text-ink-subtle transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path
                    d="M1 1L10 10M10 1L1 10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>,
    document.body,
  );
}
