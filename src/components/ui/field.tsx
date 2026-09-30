"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Form fields.
 *
 * Every control is wired the same way, because inconsistent forms are the most
 * common accessibility failure in an application:
 *
 *  - the label is a real `<label for>`, never a placeholder
 *  - the description is referenced by `aria-describedby`
 *  - the error is referenced by `aria-describedby` *and* `aria-invalid`
 *  - the error region reserves its height, so validating a form does not shove
 *    the submit button down the page
 *  - required-ness is carried by the HTML attribute, not by a red asterisk alone
 *
 * A placeholder is not a label. It disappears the moment the field has content,
 * which is exactly when the student needs to check what they typed into it.
 */

const CONTROL_BASE =
  "w-full rounded-md border bg-surface text-ink placeholder:text-ink-muted " +
  "transition-[border-color,box-shadow,background-color] duration-fast ease-out-quint " +
  "focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 " +
  "disabled:cursor-not-allowed disabled:bg-well disabled:text-ink-subtle";

const CONTROL_INVALID = "border-danger focus-visible:border-danger focus-visible:ring-danger/25";

/* -------------------------------------------------------------------------- */
/* Shell                                                                       */
/* -------------------------------------------------------------------------- */

export interface FieldShellProps {
  label: string;
  id: string;
  /** Helper text. Always rendered when there is no error, so the layout holds. */
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: {
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    "aria-required"?: boolean;
  }) => React.ReactNode;
}

export function FieldShell({
  label,
  id,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldShellProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-baseline gap-1.5 text-xs font-medium text-ink"
      >
        {label}
        {required ? (
          <span className="text-danger-hover" aria-hidden>
            *
          </span>
        ) : (
          <span className="text-2xs font-normal text-ink-subtle">optional</span>
        )}
      </label>

      {children({
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })}

      {/* The region is always present, even when empty. Reserving the space is
          what stops a form from moving its own submit button the moment it
          fails — a layout that jumps on validation is a layout people distrust. */}
      <div className="mt-1 min-h-[1.15rem]">
        {error ? (
          <p id={errorId} role="alert" className="text-xs leading-snug text-danger-hover">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs leading-snug text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Text input                                                                  */
/* -------------------------------------------------------------------------- */

export interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "prefix"> {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  /** Visual marker inside the field, e.g. a currency symbol. */
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  /** Applied to the `<input>` itself rather than to the field wrapper. */
  fieldClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, prefix, suffix, className, fieldClassName, required, ...rest },
  forwardedRef,
) {
  const generatedId = useId();
  // Prefer a stable, readable id derived from the field name over a generated
  // one: the generated form is a colon-delimited React id, which is awkward in
  // test selectors and in server logs.
  const id = rest.name ? `field-${rest.name}` : generatedId;

  return (
    <FieldShell
      label={label}
      id={id}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      {(aria) => (
        <div className="relative flex items-center">
          {prefix ? (
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 font-mono text-sm text-ink-subtle"
            >
              {prefix}
            </span>
          ) : null}
          <input
            ref={forwardedRef}
            id={id}
            required={required}
            className={cn(
              CONTROL_BASE,
              "h-[var(--control-md)] px-3 font-mono text-sm",
              "read-only:bg-well",
              prefix && "pl-8",
              suffix && "pr-16",
              error ? CONTROL_INVALID : "border-rule-strong",
              fieldClassName,
            )}
            {...aria}
            {...rest}
          />
          {suffix ? (
            <span
              aria-hidden
              className="pointer-events-none absolute right-3 text-xs text-ink-subtle"
            >
              {suffix}
            </span>
          ) : null}
        </div>
      )}
    </FieldShell>
  );
});

/* -------------------------------------------------------------------------- */
/* Textarea                                                                    */
/* -------------------------------------------------------------------------- */

export interface TextAreaFieldProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  /** Enforce a maximum and show the remaining character count. */
  maxChars?: number;
  fieldClassName?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    { label, hint, error, maxChars, className, fieldClassName, required, value, ...rest },
    forwardedRef,
  ) {
    const generatedId = useId();
    const id = rest.name ? `field-${rest.name}` : generatedId;
    const length = typeof value === "string" ? value.length : 0;
    const remaining = maxChars === undefined ? null : maxChars - length;

    return (
      <FieldShell
        label={label}
        id={id}
        hint={hint}
        error={error}
        required={required}
        className={className}
      >
        {(aria) => (
          <div className="relative">
            <textarea
              ref={forwardedRef}
              id={id}
              required={required}
              value={value}
              maxLength={maxChars}
              className={cn(
                CONTROL_BASE,
                "min-h-[7rem] resize-y px-3 py-2.5 text-sm leading-relaxed",
                maxChars && "pb-7",
                error ? CONTROL_INVALID : "border-rule-strong",
                fieldClassName,
              )}
              {...aria}
              {...rest}
            />
            {maxChars ? (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute bottom-2 right-3 font-mono text-2xs tabular-nums",
                  remaining !== null && remaining <= 0
                    ? "text-danger-hover"
                    : remaining !== null && remaining <= 40
                      ? "text-ochre-hover"
                      : "text-ink-subtle",
                )}
              >
                {remaining}
              </span>
            ) : null}
          </div>
        )}
      </FieldShell>
    );
  },
);

/* -------------------------------------------------------------------------- */
/* Select                                                                      */
/* -------------------------------------------------------------------------- */

export interface SelectFieldProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  options: { value: string; label: string; disabled?: boolean }[];
  fieldClassName?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { label, hint, error, options, className, fieldClassName, required, ...rest },
    forwardedRef,
  ) {
    const generatedId = useId();
    const id = rest.name ? `field-${rest.name}` : generatedId;

    return (
      <FieldShell
        label={label}
        id={id}
        hint={hint}
        error={error}
        required={required}
        className={className}
      >
        {(aria) => (
          <div className="relative">
            <select
              ref={forwardedRef}
              id={id}
              required={required}
              className={cn(
                CONTROL_BASE,
                "h-[var(--control-md)] cursor-pointer appearance-none px-3 pr-9 text-sm",
                error ? CONTROL_INVALID : "border-rule-strong",
                fieldClassName,
              )}
              {...aria}
              {...rest}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </select>
            <span
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle"
            >
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path
                  d="M1 1L5 5L9 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
        )}
      </FieldShell>
    );
  },
);

/* -------------------------------------------------------------------------- */
/* Checkbox                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The tick is a background image rather than a pseudo-element.
 *
 * `appearance: none` removes the platform control in every engine, and the
 * checkmark has to be added back. A pseudo-element cannot be positioned
 * relative to a replaced element consistently, and an inline SVG child would sit
 * in the accessibility tree. An inline `data:` URI on `background-image` is
 * neither, which is why it is the approach here.
 */
const TICK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2 6.2 4.6 8.8 10 3.4'/%3E%3C/svg%3E")`;

export function Checkbox({
  label,
  description,
  id: providedId,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "type"> & {
  label: React.ReactNode;
  description?: React.ReactNode;
  id?: string;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        type="checkbox"
        id={id}
        aria-describedby={descriptionId}
        className={cn(
          "mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-xs border border-rule-strong bg-surface",
          "bg-[length:0_0] bg-[position:50%] bg-no-repeat",
          "transition-[background-color,border-color,background-size] duration-fast ease-out-quint",
          "checked:border-accent checked:bg-accent checked:bg-[length:11px_11px]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        style={{ backgroundImage: TICK }}
        {...rest}
      />
      <label htmlFor={id} className="cursor-pointer select-none text-sm leading-snug text-ink">
        {label}
        {description ? (
          <span id={descriptionId} className="mt-0.5 block text-xs text-ink-muted">
            {description}
          </span>
        ) : null}
      </label>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A radio group styled as a single control.
 *
 * `role="radiogroup"` with `role="radio"` children rather than real radio
 * inputs, because the group is a single visual control and native radios cannot
 * be styled into one without either losing the arrow-key behaviour or shipping a
 * pile of `appearance: none` fixes. The trade is explicit: arrow keys and
 * roving tabindex are implemented by hand below, and Home/End are supported.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
  name,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; count?: number }[];
  className?: string;
  ariaLabel: string;
}) {
  const index = options.findIndex((option) => option.value === value);
  const move = (delta: number) => {
    const next = options[(index + delta + options.length) % options.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-rule bg-well p-0.5",
        className,
      )}
    >
      {options.map((option, optionIndex) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            // Roving tabindex: the group is one tab stop, and arrow keys move
            // within it. Without this the group is `options.length` tab stops.
            tabIndex={optionIndex === index ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(-1);
              } else if (event.key === "Home") {
                event.preventDefault();
                const first = options[0];
                if (first) onChange(first.value);
              } else if (event.key === "End") {
                event.preventDefault();
                const last = options[options.length - 1];
                if (last) onChange(last.value);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium",
              "transition-[background-color,color,box-shadow] duration-fast ease-out-quint",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
              selected
                ? "bg-surface text-ink shadow-xs"
                : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "font-mono text-2xs tabular-nums",
                  selected ? "text-ink-muted" : "text-ink-subtle",
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
