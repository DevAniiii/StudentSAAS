import { cn } from "@/lib/cn";
import { Button, LinkButton } from "./button";

/**
 * Complete UI states.
 *
 * Every screen in this app can be in one of five states, and all five are
 * designed rather than defaulted: loading, empty, error, forbidden, and success
 * with nothing to add to it. A screen that only ever handles the happy path is
 * a screen that will look broken the first time the database is briefly
 * unreachable.
 *
 * The rule for empty and error states is the same: say what happened, say what
 * the student can do, and never apologise for a failure the student did not
 * cause.
 */

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A shimmering placeholder.
 *
 * Its shape must match the content it replaces, or the layout jumps when real
 * data arrives — which is worse than showing nothing. Every skeleton in this app
 * mirrors the dimensions of the thing it stands in for.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-sm", className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3", index === lines - 1 ? "w-2/5" : index % 3 === 1 ? "w-11/12" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-rule bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-32" />
      </div>
      <SkeletonText lines={rows} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Nothing to show — and that is the correct state, not a failure.
 *
 * `icon` is a short glyph, not an illustration. An empty state in a ledger is a
 * blank column, and the honest response to a blank column is a short note, not
 * a picture of a sad box.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: { label: string; href: string } | React.ReactNode;
  secondaryAction?: { label: string; href: string } | React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden
          className="mb-1 grid size-10 place-items-center rounded-pill border border-rule bg-well text-lg text-ink-subtle"
        >
          {icon}
        </div>
      ) : null}
      <p className="text-md font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-[46ch] text-sm leading-relaxed text-ink-muted">{description}</p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {isHrefAction(action) ? (
            <LinkButton href={action.href} variant="secondary" size="sm">
              {action.label}
            </LinkButton>
          ) : (
            action
          )}
          {isHrefAction(secondaryAction) ? (
            <LinkButton href={secondaryAction.href} variant="ghost" size="sm">
              {secondaryAction.label}
            </LinkButton>
          ) : (
            secondaryAction
          )}
        </div>
      ) : null}
    </div>
  );
}

function isHrefAction(
  value: { label: string; href: string } | React.ReactNode,
): value is { label: string; href: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "href" in value &&
    "label" in value &&
    typeof (value as { href: unknown }).href === "string"
  );
}

/* -------------------------------------------------------------------------- */
/* Error                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A failure the student may or may not be able to fix.
 *
 * Two different messages on purpose. A `retryable` error offers a retry button
 * and says the problem may be temporary; a non-retryable one does not, because
 * offering "Try again" for a permission failure teaches people that buttons here
 * do not work.
 *
 * Never shows a stack trace, an internal class name, or a database message. The
 * `reference` is a request id the student can quote to support, and the
 * corresponding id is already in the server log.
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  reference,
  retryable = true,
  onRetry,
  className,
  compact = false,
}: {
  title?: string;
  description?: React.ReactNode;
  /** Request id, shown so support can find the matching log line. */
  reference?: string | null;
  retryable?: boolean;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-danger/40 bg-danger-subtle",
        compact ? "p-3" : "p-4",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-px grid size-5 shrink-0 place-items-center rounded-pill bg-danger text-[0.7rem] font-bold text-danger-fg"
        >
          !
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p>
          ) : null}
          {reference ? (
            <p className="mt-1.5 font-mono text-2xs text-ink-subtle">
              Reference <span className="text-ink-muted">{reference}</span>
            </p>
          ) : null}
        </div>
      </div>
      {retryable && onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** A single failed section inside an otherwise working page. */
export function InlineError({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("text-xs text-danger-hover", className)}>
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Forbidden / not found                                                       */
/* -------------------------------------------------------------------------- */

export function NotFoundState({
  title = "Not found",
  description = "That page is not part of your portal, or it has moved.",
  action,
}: {
  title?: string;
  description?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-20 text-center">
      <p className="font-mono text-3xl text-ink-subtle">404</p>
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="text-sm leading-relaxed text-ink-muted">{description}</p>
      <LinkButton href={action?.href ?? "/today"} variant="secondary" size="sm" className="mt-1">
        {action?.label ?? "Back to Today"}
      </LinkButton>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading overlay                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A region that is loading.
 *
 * `aria-busy` plus a live region, so a screen-reader user is told the region is
 * updating rather than being left in silence while it fills. `role="status"`
 * alone is not enough: it announces nothing unless the text inside it changes.
 */
export function LoadingRegion({
  label = "Loading",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div aria-busy="true" className={cn("relative", className)}>
      <span role="status" className="sr-only">
        {label}
      </span>
      {children}
    </div>
  );
}
