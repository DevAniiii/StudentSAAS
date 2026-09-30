// Check the colour pairs a reader actually has to resolve.
//
// A palette that looks right and fails contrast is the most common way a
// redesign ships unreadable: the swatches in a settings panel all look fine
// side by side, and nothing in that view tells you what happens when one of them
// is used for 12px body text on a page background.
//
// The pairs below are taken from the stylesheet rather than restated here, so
// this cannot drift from the palette the app actually ships. WCAG thresholds:
// 4.5:1 for body text, 3:1 for large text (>=18.66px bold or >=24px) and for
// non-text UI boundaries.
//
// Usage: node scripts/check-contrast.mjs

import { readFileSync } from "node:fs";

const sheet = readFileSync("src/styles/globals.css", "utf8");

/**
 * Read a custom property out of the stylesheet's blocks.
 *
 * `allBlocks` exists because light mode is split across two `:root` blocks — the
 * main palette, then a second one holding the `*-fg` fills that only the light
 * theme needs, since the dark theme redefines them along with everything else.
 * Reading the first block alone makes every one of those tokens look undefined,
 * which reads as a gap in the palette when it is really a gap in the checker. So
 * the light theme collects from all of them and lets later definitions win, which
 * is also what the cascade does.
 *
 * The selector arrives as a RegExp rather than a string so that a selector
 * containing brackets does not have to be escaped twice — once by the caller and
 * once by the pattern built here — which is how the dark theme's
 * `[data-theme="dark"]` went missing for a while.
 */
function token(selector, name, allBlocks = false) {
  const pattern = allBlocks
    ? /(?:^|\n):root\s*\{([\s\S]*?)\n\}/g
    : new RegExp(`${selector.source}\\s*\\{([\\s\\S]*?)\\n\\}`, "g");

  let found;
  for (const block of sheet.matchAll(pattern)) {
    const hit = block[1].match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (hit) found = hit[1];
  }
  if (!found) throw new Error(`no ${name} in ${selector.source}`);
  return found;
}

function channel(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** [foreground, background, minimum, what it is used for] */
const CHECKS = [
  ["--ink", "--paper", 4.5, "body text on the page"],
  ["--ink", "--paper-raised", 4.5, "body text on a panel"],
  ["--ink-muted", "--paper", 4.5, "secondary text on the page"],
  ["--ink-muted", "--paper-raised", 4.5, "secondary text on a panel"],
  ["--ink-subtle", "--paper", 3, "metadata on the page (large/decorative)"],
  ["--accent", "--paper", 4.5, "primary action text and links"],
  ["--accent", "--paper-raised", 4.5, "primary action on a panel"],
  ["--accent", "--accent-wash", 4.5, "accent text on a tinted surface"],
  ["--accent-fg", "--accent", 4.5, "label on a filled primary button"],
  ["--ochre", "--paper", 4.5, "deadline text on the page"],
  ["--ochre", "--ochre-wash", 4.5, "deadline text on a tinted surface"],
  ["--ochre-fg", "--ochre", 4.5, "label on a filled warning chip"],
  ["--vermilion", "--paper", 4.5, "error text on the page"],
  ["--vermilion", "--vermilion-wash", 4.5, "error text on a tinted surface"],
  ["--vermilion-fg", "--vermilion", 4.5, "label on a filled error chip"],
  ["--slate", "--paper", 4.5, "informational text on the page"],
  ["--slate-fg", "--slate", 4.5, "label on a filled info chip"],

  // Boundaries. These are WCAG 1.4.11 (3:1), not text contrast, and they are
  // checked against both surfaces a boundary can land on, because a rule that
  // clears the page can still vanish into a panel.
  ["--rule-strong", "--paper-raised", 3, "chip / stamp border on a panel"],
  ["--rule-strong", "--paper", 3, "chip / stamp border on the page"],
  // Form controls take their colour from `currentColor` — `CONTROL_BASE` in
  // `components/ui/field.tsx` sets `border` with no colour, so the border is
  // whatever the field's text colour is. That is `--ink`, and it is checked here
  // so that if someone gives the control a text colour the boundary loses, this
  // is the assertion that says so.
  ["--ink", "--paper-raised", 3, "form control border on a panel"],
  ["--ink", "--paper", 3, "form control border on the page"],
];

for (const [selector, label, allBlocks] of [
  [/:root/, "light", true],
  [/\[data-theme="dark"\]/, "dark", false],
]) {
  console.log(`\n=== ${label} ===`);
  let failures = 0;
  for (const [fg, bg, min, use] of CHECKS) {
    let r;
    try {
      r = ratio(token(selector, fg, allBlocks), token(selector, bg, allBlocks));
    } catch (error) {
      console.log(`  ?  ${fg} on ${bg}: ${error.message}`);
      failures++;
      continue;
    }
    const pass = r >= min;
    if (!pass) failures++;
    console.log(
      `  ${pass ? "ok  " : "FAIL"}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${fg} on ${bg} — ${use}`,
    );
  }
  console.log(`  ${failures === 0 ? "all pairs pass" : `${failures} pair(s) below threshold`}`);
}