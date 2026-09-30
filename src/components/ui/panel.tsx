import { cn } from "@/lib/cn";

/**
 * Surfaces.
 *
 * A `Panel` is the app's page-block: ruled, square-cornered, and flat by default.
 * Three depths, each with a reason:
 *
 *  - `flat`   sits on the paper. Most content.
 *  - `raised` a card within a card, or something that must read as pickable.
 *  - `sunken` a well: code, figures being read closely, a recessed register.
 *
 * Elevation is border weight first and shadow second. A ledger does not float;
 * it stacks. Shadows exist here to separate *layers of paper*, not to imply
 * z-index depth in a spatial metaphor the rest of the design does not use.
 */

export function Panel({
  as: Tag = "section",
  tone = "flat",
  className,
  children,
  ...rest
}: Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  tone?: "flat" | "raised" | "sunken";
  /** Element to render. A page block is a `<section>`; a card is an `<article>`. */
  as?: React.ElementType;
}) {
  return (
    <Tag
      className={cn(
        "rounded-lg border",
        tone === "flat" && "border-rule bg-surface",
        tone === "raised" && "border-rule-strong bg-surface shadow-sm",
        tone === "sunken" && "border-rule bg-well",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export interface PanelHeaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  /** Small print under the title — counts, filters, context. */
  description?: React.ReactNode;
  /** Right-aligned controls: a filter group, an action, a link. */
  actions?: React.ReactNode;
  /** Rendered left of the title. A count, an icon, a course code chip. */
  leading?: React.ReactNode;
  /** Reduce vertical padding, for panels nested inside another panel. */
  dense?: boolean;
  /** Heading level, for document outline correctness. Defaults to `h2`. */
  as?: "h2" | "h3" | "h4";
  id?: string;
}

export function PanelHeader({
  title,
  description,
  actions,
  leading,
  dense = false,
  as: Heading = "h2",
  className,
  id,
  ...rest
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-rule",
        dense ? "px-3 py-2" : "px-4 py-3.5",
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 items-baseline gap-2.5">
        {leading ? <span className="shrink-0 self-center">{leading}</span> : null}
        <div className="min-w-0">
          <Heading
            id={id}
            className={cn(
              "truncate text-md font-semibold tracking-[-0.012em] text-ink",
              Heading === "h4" && "text-sm",
            )}
          >
            {title}
          </Heading>
          {description ? (
            <p className="mt-0.5 text-xs leading-snug text-ink-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function PanelFooter({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-well px-4 py-2.5 text-xs text-ink-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Page title block.
 *
 * Sits above the content, not inside a panel: the page title is furniture, and
 * putting it in a card makes the page look like a document with a cover sheet.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 font-mono text-2xs uppercase tracking-[0.14em] text-ink-subtle">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-[-0.024em] text-ink">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A ruled horizontal band. The ledger's structural motif. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cn("h-px border-0 bg-rule", className)} />;
}
