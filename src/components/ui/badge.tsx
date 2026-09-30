import { cn } from "@/lib/cn";

/**
 * Badges and chips.
 *
 * Tones are semantic, not decorative. There are exactly six, and each one means
 * one thing across the whole app — a badge's colour is information, so a tone
 * must never be chosen for variety.
 *
 * Status is never carried by colour alone: every badge includes a text label, and
 * the dot variants pair the colour with a shape difference so they remain
 * distinguishable in greyscale and to a reader with a colour vision deficiency.
 */

export type Tone = "neutral" | "good" | "warn" | "danger" | "info" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "border-rule bg-well text-ink-muted",
  good: "border-accent/40 bg-accent-subtle text-accent",
  warn: "border-ochre/45 bg-ochre-subtle text-ochre-hover",
  danger: "border-danger/45 bg-danger-subtle text-danger-hover",
  info: "border-info/45 bg-info-subtle text-info",
  accent: "border-ochre/45 bg-ochre-subtle text-ochre-hover",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** A leading dot. Adds a non-colour signal to the label. */
  dot?: boolean;
  size?: "sm" | "md";
  children: React.ReactNode;
}

export function Badge({
  tone = "neutral",
  dot = false,
  size = "sm",
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-current opacity-80"
        />
      ) : null}
      {children}
    </span>
  );
}

/**
 * A monospaced identifier.
 *
 * Course codes, invoice numbers, receipt numbers, session ids. Monospace and
 * letterspaced, because these are keys into a system and the eye should not
 * parse them as prose — `INV-2026-0142` and `INV-2026-014Z` are one glyph apart
 * in a proportional face and obvious in this one.
 */
export function Code({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <span
      className={cn(
        "font-mono text-[0.92em] tracking-[0.02em] text-ink-muted tabular-nums",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/** A larger course-code chip, for section headers and page eyebrows. */
export function CourseChip({
  code,
  className,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { code: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-rule-strong bg-well px-1.5 py-0.5",
        "font-mono text-2xs font-medium uppercase tracking-[0.08em] text-ink",
        className,
      )}
      {...rest}
    >
      {code}
    </span>
  );
}
