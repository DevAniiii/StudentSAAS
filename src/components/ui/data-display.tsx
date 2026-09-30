import { cn } from "@/lib/cn";
import type { LetterGrade } from "@/lib/grades";

/**
 * Data display.
 *
 * The rule for all of these: a number is never the only way the information is
 * carried. A meter has a value beside it, a gauge has its figure in the middle, a
 * grade stamp has the percentage next to it. Someone using a screen reader, or
 * printing in black and white, or glancing away mid-animation, still gets the
 * answer.
 */

/* -------------------------------------------------------------------------- */
/* Meter                                                                       */
/* -------------------------------------------------------------------------- */

export interface MeterProps {
  /** 0–100. Clamped, so a bad query cannot render a bar wider than its track. */
  value: number;
  tone?: "primary" | "warn" | "danger" | "info";
  /** Diagonal hatch, for a portion that is committed but not yet finalised. */
  striped?: boolean;
  /** Thickness. */
  size?: "sm" | "md";
  className?: string;
  /** Accessible description. Required — the bar itself conveys nothing. */
  label: string;
}

export function Meter({
  value,
  tone = "primary",
  striped = false,
  size = "md",
  className,
  label,
}: MeterProps) {
  const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100);
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        "meter",
        tone === "warn" && "meter--warn",
        tone === "danger" && "meter--danger",
        tone === "info" && "meter--info",
        striped && "meter--striped",
        size === "sm" && "!h-1.5",
        className,
      )}
    >
      <div className="meter__fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Gauge                                                                       */
/* -------------------------------------------------------------------------- */

export function Gauge({
  value,
  tone = "primary",
  size = "md",
  className,
  label,
  children,
}: {
  value: number;
  tone?: "primary" | "warn" | "danger" | "info";
  size?: "sm" | "md";
  className?: string;
  label: string;
  children?: React.ReactNode;
}) {
  const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100);
  return (
    <div
      className={cn(
        "gauge",
        tone === "warn" && "gauge--warn",
        tone === "danger" && "gauge--danger",
        tone === "info" && "gauge--info",
        size === "sm" && "gauge--sm",
        className,
      )}
      style={{ "--gauge-value": clamped } as React.CSSProperties}
    >
      <div
        className="relative z-10 grid place-items-center leading-none"
        role="img"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Grade stamp                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The letterpress stamp.
 *
 * A projected letter is deliberately *not* stamped. A stamp is a record; showing
 * `A-` in stamp form at week 6 would assert a result that does not exist yet. The
 * in-progress state gets a dashed outline and "IP", which is a different claim
 * and looks like one.
 */
export function GradeStamp({
  letter,
  className,
  size = "md",
}: {
  letter: LetterGrade | "IP" | null;
  className?: string;
  size?: "sm" | "md";
}) {
  if (!letter) {
    return (
      <span
        aria-hidden
        className={cn(
          "grade-stamp grade-stamp--ip text-ink-subtle",
          size === "sm" && "!size-7 !text-xs",
          className,
        )}
      >
        —
      </span>
    );
  }

  const band = letter === "IP" ? "ip" : letter.startsWith("A") ? "a" : letter.startsWith("B") ? "b" : letter.startsWith("F") ? "f" : "c";

  return (
    <span
      className={cn(
        "grade-stamp",
        `grade-stamp--${band}`,
        size === "sm" && "!size-7 !text-xs",
        className,
      )}
    >
      {letter}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Figure                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A large number with a unit or caption.
 *
 * `tabular-nums` is not optional. These figures sit in columns and update
 * independently; without tabular figures every digit change reflows the whole
 * row, which is exactly the jitter a ledger must not have.
 */
export function Figure({
  value,
  label,
  hint,
  tone = "neutral",
  align = "left",
  className,
  children,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger" | "info";
  align?: "left" | "right";
  className?: string;
  children?: React.ReactNode;
}) {
  const valueTone = {
    neutral: "text-ink",
    good: "text-accent",
    warn: "text-ochre-hover",
    danger: "text-danger-hover",
    info: "text-info",
  }[tone];

  return (
    <div className={cn("min-w-0", align === "right" && "text-right", className)}>
      <div
        className={cn(
          "font-mono text-2xl font-medium leading-none tracking-[-0.02em] tabular-nums",
          valueTone,
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-xs leading-snug text-ink-muted">{label}</div>
      {hint ? <div className="mt-0.5 text-2xs leading-snug text-ink-subtle">{hint}</div> : null}
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Definition list                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A label/value pair on a ruled baseline.
 *
 * Not a `<table>`: these pairs are not tabular data, they are a definition list,
 * and screen readers announce it better. Alignment comes from the ruled
 * baseline, so values still form a column.
 */
export function DataRow({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 border-b border-rule py-2 last:border-b-0",
        className,
      )}
    >
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right font-mono text-sm tabular-nums text-ink">{children}</dd>
    </div>
  );
}

export function DataList({ className, children }: { className?: string; children: React.ReactNode }) {
  return <dl className={cn("divide-y divide-rule", className)}>{children}</dl>;
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Initial avatar.
 *
 * No images, deliberately: a student portal should not need a round-trip to a
 * avatar CDN to render a list of people, and photographs in an academic records
 * system are a privacy question the institution should answer, not the app.
 *
 * The hue is stored per user and is stable, so the same person is always the
 * same colour — which makes a list of names scannable without photographs.
 */
export function Avatar({
  initials,
  hue = 150,
  size = "md",
  title,
  className,
}: {
  initials: string;
  /** 0–360. Kept desaturated; a fully saturated avatar is a colour-vision
   *  problem waiting to happen. */
  hue?: number;
  size?: "xs" | "sm" | "md" | "lg";
  title?: string;
  className?: string;
}) {
  const dimensions = {
    xs: "size-5 text-[0.5rem]",
    sm: "size-7 text-2xs",
    md: "size-9 text-xs",
    lg: "size-12 text-sm",
  }[size];

  // S, L and very light hues are hard to read on paper. The lightness floor
  // keeps the initials legible in light and dark themes alike, because the
  // background is derived from the hue rather than from a fixed palette entry.
  const background = `oklch(0.9 0.045 ${hue})`;
  const foreground = `oklch(0.32 0.06 ${hue})`;

  return (
    <span
      title={title}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-pill border border-rule font-semibold uppercase tracking-wide",
        dimensions,
        className,
      )}
      style={{ backgroundColor: background, color: foreground }}
    >
      {initials}
    </span>
  );
}
