"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Theme and density.
 *
 * Two sources of truth that must be reconciled, not merged:
 *
 *  - **localStorage** is authoritative for the *current device*, because it is
 *    the only thing available before first paint and the only thing that can be
 *    read synchronously by the boot script in `layout.tsx`.
 *  - **the database** holds the student's stated preference, which follows them
 *    to another device.
 *
 * The rule: the device value wins for rendering, and it is pushed to the
 * database when it differs. Reverse that — let a stale server value clobber a
 * fresh local choice — and toggling the theme on a laptop would silently
 * propagate to a phone the student is not holding.
 *
 * `SYSTEM` is a real third value, not a synonym for light: it tracks the OS, and
 * the resolved theme updates live as the OS changes.
 *
 * Storage keys must stay in sync with `THEME_BOOTSTRAP` in `src/app/layout.tsx`.
 */

export type ThemeSetting = "LIGHT" | "DARK" | "SYSTEM";
export type DensitySetting = "COMFORTABLE" | "COMPACT";
export type ResolvedTheme = "light" | "dark";

const THEME_KEY = "sf:theme";
const DENSITY_KEY = "sf:density";

interface ThemeContextValue {
  /** What the student chose. */
  setting: ThemeSetting;
  /** What is actually on screen. Never `SYSTEM`. */
  resolved: ResolvedTheme;
  density: DensitySetting;
  setSetting: (setting: ThemeSetting) => void;
  setDensity: (density: DensitySetting) => void;
  /** Cycle light → dark → system, for a single toggle button. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredTheme(): ThemeSetting | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    // Only two of the three settings are ever stored: `SYSTEM` is represented by
    // the *absence* of the key, so switching back to "match my system" clears it
    // rather than writing a third value the boot script would have to parse.
    if (value === "light" || value === "dark") return value.toUpperCase() as ThemeSetting;
    return null;
  } catch {
    // Private browsing, or storage disabled by policy. The OS preference is a
    // perfectly good fallback.
    return null;
  }
}

function readStoredDensity(): DensitySetting {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === "compact" ? "COMPACT" : "COMFORTABLE";
  } catch {
    return "COMFORTABLE";
  }
}

export function ThemeProvider({
  children,
  initialSetting = "SYSTEM",
  initialDensity = "COMFORTABLE",
  /** Called when the student changes a preference, so it can be persisted. */
  onPersist,
}: {
  children: ReactNode;
  initialSetting?: ThemeSetting;
  initialDensity?: DensitySetting;
  onPersist?: (next: { setting: ThemeSetting; density: DensitySetting }) => void;
}) {
  // The stored value wins on first render because that is what the boot script
  // already applied to <html>. Starting from the server value would paint
  // correctly (the attribute is already set) but would report the wrong thing
  // to the toggle button until the next effect.
  const [setting, setSettingState] = useState<ThemeSetting>(() => {
    if (typeof window === "undefined") return initialSetting;
    const stored = readStoredTheme();
    return stored ? (stored as ThemeSetting) : initialSetting;
  });
  const [density, setDensityState] = useState<DensitySetting>(() =>
    typeof window === "undefined" ? initialDensity : readStoredDensity(),
  );
  const [systemValue, setSystemValue] = useState<ResolvedTheme>(systemTheme);

  // Follow the OS while the setting is SYSTEM.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) =>
      setSystemValue(event.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme =
    setting === "SYSTEM" ? systemValue : setting === "DARK" ? "dark" : "light";

  // Reflect onto <html>. This is the only thing that actually changes the
  // appearance, and it is done by attribute rather than by class so the CSS
  // cascade has a single, predictable hook.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    try {
      if (setting === "SYSTEM") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, resolved);
    } catch {
      /* storage unavailable; the attribute is still set */
    }
  }, [resolved, setting]);

  useEffect(() => {
    document.documentElement.setAttribute("data-density", density.toLowerCase());
    try {
      window.localStorage.setItem(
        DENSITY_KEY,
        density === "COMPACT" ? "compact" : "comfortable",
      );
    } catch {
      /* ignore */
    }
  }, [density]);

  const setSetting = useCallback(
    (next: ThemeSetting) => {
      setSettingState(next);
      onPersist?.({ setting: next, density });
    },
    [density, onPersist],
  );

  const setDensity = useCallback(
    (next: DensitySetting) => {
      setDensityState(next);
      onPersist?.({ setting, density: next });
    },
    [setting, onPersist],
  );

  const toggle = useCallback(() => {
    // Toggle between the two explicit settings. Jumping to `SYSTEM` from a
    // toggle button is a surprise; `SYSTEM` is reachable from the settings page
    // where a three-way choice belongs.
    setSetting(resolved === "dark" ? "LIGHT" : "DARK");
  }, [resolved, setSetting]);

  const value = useMemo<ThemeContextValue>(
    () => ({ setting, resolved, density, setSetting, setDensity, toggle }),
    [setting, resolved, density, setSetting, setDensity, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside a ThemeProvider");
  return context;
}

/** Icons for the three states. Drawn rather than imported, so there is no icon
 *  font and no extra network request for three glyphs. */
export function ThemeIcon({ resolved }: { resolved: ResolvedTheme }) {
  if (resolved === "dark") {
    return (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
        <path
          d="M13 9.2A5.8 5.8 0 0 1 5.8 2a5.8 5.8 0 1 0 7.2 7.2Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M7.5 1v1.6M7.5 12.4V14M14 7.5h-1.6M2.6 7.5H1M12.1 2.9l-1.1 1.1M4 11l-1.1 1.1M12.1 12.1 11 11M4 4 2.9 2.9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
