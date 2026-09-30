import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "../styles/globals.css";

/**
 * Typography.
 *
 * Three faces, each with a job — no default UI stack, and specifically no
 * Inter/Roboto/Arial, which would undo the editorial character the rest of the
 * system depends on.
 *
 *  - Fraunces          display. Variable, with SOFT/WONK/opsz unlocked.
 *  - Space Grotesk     all UI text. Geometric enough to feel current, neutral
 *                      enough to disappear behind the content.
 *  - JetBrains Mono    every figure, identifier and code-like string. Tabular
 *                      figures are what make a ledger column line up.
 *
 * `display: swap` and a metric-adjusted fallback keep the first paint from
 * shifting while the fonts load.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-grotesk",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: {
    default: "ScholarFolio — Student Portal",
    template: "%s · ScholarFolio",
  },
  description:
    "Coursework, grades, attendance and fees for enrolled students. One ledger for the whole term.",
  applicationName: "ScholarFolio",
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#161816" },
  ],
  width: "device-width",
  initialScale: 1,
  // Zoom is never disabled. The type scale is tuned so 200% zoom is usable.
};

/**
 * Runs before first paint, inline in <head>.
 *
 * This has to be synchronous and blocking: anything asynchronous leaves a window
 * in which the page paints light and then snaps to dark, which is worse than
 * having no dark mode at all. It reads the stored preference, falls back to the
 * OS setting, and writes `data-theme` and `data-density` onto <html>.
 *
 * Preference key names must stay in sync with `src/components/shell/theme.tsx`.
 */
const THEME_BOOTSTRAP = `
(function () {
  try {
    var root = document.documentElement;
    var stored = null;
    try { stored = localStorage.getItem("sf:theme"); } catch (e) {}

    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    root.setAttribute("data-theme", theme);

    var density = null;
    try { density = localStorage.getItem("sf:density"); } catch (e) {}
    root.setAttribute("data-density", density === "compact" ? "compact" : "comfortable");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.setAttribute("data-density", "comfortable");
  }
})();
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // Only announces the boot script; the content itself belongs in <body>.
      suppressHydrationWarning
      className={`${fraunces.variable} ${grotesk.variable} ${jetbrains.variable}`}
      data-theme="light"
      data-density="comfortable"
    >
      <head>
        <script
          // Blocking by design: this must land before the first paint.
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
      </head>
      <body>
        {/*
          Skip link first in the DOM so keyboard users reach content on the
          first Tab press, not after traversing the whole navigation.
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[1000] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-fg focus:shadow-lg"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
