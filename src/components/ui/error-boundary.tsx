"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * The body of an error boundary.
 *
 * Deliberately has no dependency on the app shell — no sidebar, no topbar, no
 * notification fetch. A boundary that reached for the shell would fail in exactly
 * the situation it exists to handle: the shell is what threw, or the database
 * behind it is unreachable. It renders its own minimal page frame instead, which
 * is the only version of this component guaranteed to work.
 *
 * The same component serves the route-level and the global boundary, so the two
 * cannot drift apart in tone or in what they promise the reader.
 */
export function ErrorBoundaryBody({
  title,
  description,
  reference,
  onRetry,
  retryable = true,
}: {
  title: string;
  description: string;
  reference?: string | null;
  onRetry?: () => void;
  retryable?: boolean;
}) {
  // The server log already has the stack, correlated by this id. Logging it a
  // second time client-side would add a console line nobody reads and, on a
  // shared machine, one that persists after the tab closes.
  useEffect(() => {
    if (reference) console.error(`[folio] render failed, reference ${reference}`);
  }, [reference]);

  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
      <div
        role="alert"
        className="w-full max-w-md rounded-lg border border-rule bg-surface p-5 shadow-sm"
      >
        <span
          aria-hidden
          className="grid size-6 place-items-center rounded-pill bg-danger-subtle text-xs font-bold text-danger"
        >
          !
        </span>

        <h1 className="mt-3 font-display text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</p>

        {reference ? (
          <p className="mt-3 font-mono text-2xs text-ink-subtle">
            Reference <span className="text-ink-muted">{reference}</span>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {retryable && onRetry ? (
            <Button variant="primary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => window.location.assign("/")}>
            Go to the front door
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A short, non-identifying id for the failure.
 *
 * Generated on the client because the render that failed may not have produced
 * one. It exists so a student can quote something to support that is not a
 * timestamp, which is already in the access log.
 */
export function referenceId(): string | null {
  try {
    return `sf_${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return null;
  }
}

/**
 * Is this the database being unreachable, rather than a bug?
 *
 * A student cannot act on "a query failed". They can act on "the records service
 * is down, nothing you did caused this, try again in a minute" — so the two cases
 * are given different words. The classification is coarse on purpose: it reads
 * the digest that Next attaches to a server-side throw, not a message, so it
 * cannot accidentally echo a connection string or a query into the page.
 */
export function isDataOutage(digest: string | undefined): boolean {
  if (!digest) return false;
  return /DATA_UNAVAILABLE|ECONNREFUSED|ETIMEDOUT|P1001|P1002|P1017/i.test(digest);
}
