"use client";

import { useEffect } from "react";
import {
  ErrorBoundaryBody,
  isDataOutage,
  referenceId,
} from "@/components/ui/error-boundary";

/**
 * The last-resort boundary.
 *
 * Replaces the root layout entirely, so it must render its own `<html>` and
 * `<body>` and cannot rely on any provider, token class, or context established
 * above it. That is why it shares only the leaf `ErrorBoundaryBody` with the
 * route-level boundary and nothing else — if this file reached for the shell, the
 * shell is a plausible reason it is running.
 *
 * The font variables live on the root layout's `<html>`, so they are absent here.
 * Rather than pretend, the body falls back to the system stack defined in
 * `globals.css` as the `--font-sans` fallback chain, which is what renders if the
 * webfont never loads. A slightly different typeface on an error page is a fair
 * trade for an error page existing at all.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const outage = isDataOutage(error.digest);
  const reference = referenceId();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" data-theme="light">
      <body className="bg-paper text-ink">
        <ErrorBoundaryBody
          title={outage ? "The records service is not reachable" : "ScholarFolio could not start"}
          description={
            outage
              ? "The database this portal reads from is not answering. Nothing you have done is the cause. Try again shortly."
              : "A failure this early means the application itself could not render. Try again, and if it persists, quote the reference below to support."
          }
          reference={reference}
          onRetry={reset}
        />
      </body>
    </html>
  );
}
