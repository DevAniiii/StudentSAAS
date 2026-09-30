"use client";

import { useEffect } from "react";
import {
  ErrorBoundaryBody,
  isDataOutage,
  referenceId,
} from "@/components/ui/error-boundary";

/**
 * The error boundary for the authenticated shell.
 *
 * Sits inside the shell rather than at the root, so a failure in one screen still
 * renders with the sidebar and topbar around it. Losing the whole chrome because
 * one panel threw is a worse experience than the failure itself, and the student
 * keeps their place and their navigation.
 *
 * The words change with the cause. A database outage is the common cause and the
 * one a student most often sees, and "the records service is not reachable, try
 * again shortly" is actionable where "something went wrong" is not — it tells
 * them this is not their fault and that waiting is the right move.
 *
 * The digest is inspected, never rendered. It is Next's opaque hash of a
 * server-side error; printing it would leak an internal identifier, and printing
 * what it was derived from could leak a connection string.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const outage = isDataOutage(error.digest);
  const reference = referenceId();

  useEffect(() => {
    // The real stack is already in the server log. This is the browser-side half,
    // recorded so a report from a specific browser is distinguishable from one
    // that only ever reached the server.
    console.error(error);
  }, [error]);

  return (
    <ErrorBoundaryBody
      title={outage ? "The records service is not reachable" : "This screen could not be loaded"}
      description={
        outage
          ? "Your account is fine — the database this page reads from is not answering. Nothing you have done is the cause. Try again in a minute or two."
          : "Something went wrong rendering this page. The rest of the portal still works; use the sidebar to go somewhere else, or try again."
      }
      reference={reference}
      onRetry={reset}
    />
  );
}
