import { forwardRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Button.
 *
 * One component, rendered as `<button>`, `<a>` (via `next/link` when `href` is
 * internal) or a submit input — because a "button" that is actually a div with a
 * click handler is not focusable, not in the tab order, and does not fire on
 * Enter.
 *
 * Every variant has a defined appearance for: rest, hover, active, focus-visible,
 * disabled and loading. The focus ring is `focus-visible`, never `focus`, so a
 * mouse click does not leave a ring behind — but a keyboard press always does.
 *
 * Loading is a real state, not a spinner bolted on: the button keeps its width so
 * the layout does not jump, and stays `disabled` so it cannot be double-submitted.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg border border-accent hover:bg-accent-hover hover:border-accent-hover active:bg-accent-active",
  secondary:
    "bg-surface text-ink border border-rule-strong hover:bg-hover hover:border-ink-subtle active:bg-active",
  ghost:
    "bg-transparent text-ink border border-transparent hover:bg-hover active:bg-active",
  quiet:
    "bg-well text-ink-muted border border-transparent hover:text-ink hover:bg-hover active:bg-active",
  danger:
    "bg-danger text-danger-fg border border-danger hover:bg-danger-hover hover:border-danger-hover active:bg-danger-hover",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-[var(--control-sm)] px-2.5 text-xs gap-1.5 rounded-sm",
  md: "h-[var(--control-md)] px-3.5 text-sm gap-2 rounded-md",
  lg: "h-[var(--control-lg)] px-5 text-md gap-2 rounded-md",
};

const BASE =
  "relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-fast ease-out-quint " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-45 disabled:saturate-50";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show a spinner and block interaction. Keeps the button's width. */
  loading?: boolean;
  /** Stretch to the container's width. */
  block?: boolean;
  /** Text announced while `loading` is true, since the label is visually hidden. */
  loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    block = false,
    loadingLabel = "Working…",
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], block && "w-full", className)}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner />
          {/* The label is kept in the layout so the width does not change, but
              hidden from assistive tech, which gets the status instead. */}
          <span aria-hidden className="invisible">
            {children}
          </span>
          <span className="sr-only" role="status">
            {loadingLabel}
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
});

export interface LinkButtonProps
  extends React.ComponentPropsWithoutRef<typeof Link>,
    Pick<ButtonProps, "variant" | "size"> {
  block?: boolean;
}

/** A link that looks like a button. Used for navigation, never for actions. */
export function LinkButton({
  variant = "secondary",
  size = "md",
  block = false,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link
      className={cn(BASE, VARIANTS[variant], SIZES[size], block && "w-full", className)}
      {...rest}
    >
      {children}
    </Link>
  );
}

/** An anchor that looks like a button, for external and protocol links. */
export function AnchorButton({
  variant = "ghost",
  size = "md",
  className,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> &
  Pick<ButtonProps, "variant" | "size">) {
  return (
    <a className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...rest}>
      {children}
    </a>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "spinner size-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent opacity-80",
        className,
      )}
    />
  );
}

/** An icon-only button. `label` is required — there is no unlabelled icon button. */
export function IconButton({
  label,
  className,
  children,
  size = "md",
  variant = "ghost",
  ...rest
}: Omit<ButtonProps, "size" | "children"> & {
  label: string;
  children: React.ReactNode;
  size?: ButtonSize;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        BASE,
        VARIANTS[variant],
        size === "sm" && "size-[var(--control-sm)] px-0",
        size === "md" && "size-[var(--control-md)] px-0",
        size === "lg" && "size-[var(--control-lg)] px-0",
        "rounded-md",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
