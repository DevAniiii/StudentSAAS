// Solve for a palette value that clears a contrast target.
//
// A contrast checker tells you a pair failed; it cannot tell you what to change.
// This walks a colour toward black or white and reports the first step that
// clears the target, so fixing a failing pair is a lookup rather than an
// afternoon of nudging hex codes and re-running the checker.
//
// The hue is preserved along the way — only brightness moves — because a border
// that passes contrast by turning grey still has to belong to the palette.
//
// Usage: node scripts/solve-contrast.mjs <bg> <start> <target> [<label>]

const channel = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
  const at = (i) => channel(parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * at(1) + 0.7152 * at(3) + 0.0722 * at(5);
};

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = ([r, g, b]) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Blend two colours, moving all three channels together. */
function blend(from, to, t) {
  const a = parse(from);
  const b = parse(to);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t));
}

const [bg, start, targetRaw, label] = process.argv.slice(2);
const target = Number(targetRaw);

// Contrast rises by moving *away* from the background, so the direction is
// decided by how light the background is — not by how light the colour being
// adjusted is. Getting that backwards walks the value the short way, straight
// into the background, and reports that nothing can be done.
const towards = luminance(bg) > 0.5 ? "#000000" : "#ffffff";
const darker = towards === "#000000";

console.log(`${label ?? start} against ${bg}, target ${target}:1`);
console.log(`  now     ${start}  ${ratio(start, bg).toFixed(2)}:1`);

let solved = null;
for (let step = 1; step <= 100; step++) {
  const candidate = blend(start, towards, step / 100);
  if (ratio(candidate, bg) >= target) {
    solved = candidate;
    break;
  }
}

if (!solved) {
  console.log("  no value on this hue clears the target; the hue itself has to change");
} else {
  console.log(`  use     ${solved}  ${ratio(solved, bg).toFixed(2)}:1  (${darker ? "darker" : "lighter"})`);
}