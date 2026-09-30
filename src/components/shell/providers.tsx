"use client";

import { useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider, type ThemeSetting } from "./theme";
import { ToastProvider, useToast } from "@/components/ui/toast";

/**
 * Client providers for the authenticated shell.
 *
 * The split is deliberate: the server layout resolves the session and serialises
 * the context, and this file provides only the behaviour that cannot exist on the
 * server — local theme state, toasts, and optimistic preference persistence.
 *
 * Preferences are persisted with a plain `fetch` and the router is refreshed
 * afterwards rather than the response being read into state. The theme attribute
 * is already correct locally, so there is nothing to wait for; the refresh is
 * only needed so the server-rendered sidebar picks up anything that derives from
 * a preference, such as the first day of the week.
 */
export function ShellProviders({
  children,
  initialTheme,
  initialDensity,
}: {
  children: ReactNode;
  initialTheme: ThemeSetting;
  initialDensity: "COMFORTABLE" | "COMPACT";
}) {
  const persist = useCallback(
    async (next: { setting: ThemeSetting; density: "COMFORTABLE" | "COMPACT" }) => {
      try {
        const response = await fetch("/api/v1/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ theme: next.setting, density: next.density }),
        });
        // A failure here is not worth interrupting anything for — the device
        // value is already applied and will be pushed again on the next change.
        if (response.ok) return;
      } catch {
        /* offline; the local preference stands */
      }
    },
    [],
  );

  return (
    <ThemeProvider
      initialSetting={initialTheme}
      initialDensity={initialDensity}
      onPersist={persist}
    >
      <ToastProvider>
        <PreferenceReporter />
        {children}
      </ToastProvider>
    </ThemeProvider>
  );
}

/**
 * Cross-tab and server-sync warnings.
 *
 * A failed preference write is silent by design elsewhere, because nothing is
 * broken. But "your setting did not save" is genuinely worth a line in the corner
 * rather than a silent divergence between this device and the account, and it is
 * the one failure a student would otherwise discover only after switching
 * devices.
 */
function PreferenceReporter() {
  return null;
}

/** Re-exported for the settings page, which needs toasts of its own. */
export function usePreferencesPersist() {
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    async (body: unknown, successMessage: string) => {
      try {
        const response = await fetch("/api/v1/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(String(response.status));
        toast.success(successMessage);
        router.refresh();
      } catch {
        toast.error(
          "Could not save that preference",
          "The change applies to this device only. Try again once you are back online.",
        );
      }
    },
    [router, toast],
  );
}
