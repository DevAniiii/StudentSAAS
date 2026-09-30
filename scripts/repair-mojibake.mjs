// Repair mojibake: text that was UTF-8, decoded as Windows-1252, and re-saved.
//
// The failure mode is specific and worth naming, because it looks like corruption
// rather than what it is. Windows PowerShell 5.1's `Get-Content -Raw` decodes
// using the system ANSI codepage unless the file carries a BOM, so a UTF-8 file
// full of em-dashes and curly quotes comes back as `â€”` and `â€` — one
// Latin-1-shaped character per original byte. Saving that re-encodes the damage
// as UTF-8, and the damage is now permanent: the original bytes are gone, only
// the wrong interpretation of them survives.
//
// This reverses that. Every maximal run of non-ASCII characters is mapped back to
// the bytes it would have been decoded from, and those bytes are read as UTF-8.
// A run that is not valid UTF-8 was not mojibake to begin with — a lone `©` in
// a copyright line, say — and is left exactly as it was. That is the check that
// makes the whole thing safe to run across a tree rather than file by file, and
// it makes the script idempotent: a second pass finds nothing to change.
//
// It is safe to run at any time. It never touches ASCII, and it only ever
// replaces a run when the replacement is provably the text that was lost.
//
// Usage: node scripts/repair-mojibake.mjs [--report] <root...>

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The characters Windows-1252 puts in 0x80–0x9F, where Latin-1 has controls.
 * Without this table those bytes decode to U+20AC and friends, and reversing the
 * round trip would have to strip their high bits — which recovers the wrong byte.
 */
const CP1252_HIGH = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

function cp1252Byte(codePoint) {
  if (codePoint >= 0x80 && codePoint <= 0x9f) {
    // Windows-1252 leaves 0x81, 0x8d, 0x8f, 0x90 and 0x9d undefined, so those
    // positions decoded as the Latin-1 controls they most resemble.
    return codePoint;
  }
  return CP1252_HIGH[codePoint] ?? codePoint;
}

function repair(text) {
  let out = "";
  let i = 0;
  let fixed = 0;
  while (i < text.length) {
    const codePoint = text.codePointAt(i);
    if (codePoint < 0x80) {
      out += text[i];
      i += 1;
      continue;
    }

    // Take the whole run of non-ASCII, so a three-byte sequence stays together.
    // Each step advances by the length of the character just consumed, not by
    // the length of the run so far — accumulating the latter overshoots and
    // samples every other character, which silently repairs nothing.
    let run = "";
    let j = i;
    while (j < text.length && text.codePointAt(j) >= 0x80) {
      const char = String.fromCodePoint(text.codePointAt(j));
      run += char;
      j += char.length;
    }

    // A run of one character is never mojibake. Every damaged sequence here is
    // the misreading of a two- or three-byte UTF-8 character, so it is always at
    // least that long. This guard exists for characters that survive the byte
    // round trip as themselves — `⌘` (U+2318) masks to 0x18, which is a legal
    // byte that decodes back to U+0018, and `✉` and `−` behave the same way.
    // Testing those runs for validity is not enough: they pass, and the symbol
    // silently becomes a control character. Only a genuine multi-byte mess has
    // more than one character to lose.
    if (run.length < 2) {
      out += run;
      i = j;
      continue;
    }

    const bytes = Buffer.from([...run].map((c) => cp1252Byte(c.codePointAt(0)) & 0xff));
    const decoded = bytes.toString("utf8");
    // `toString` substitutes U+FFFD for invalid bytes rather than throwing, so a
    // round trip that produced a replacement character was not valid UTF-8 and
    // the run was already correct.
    if (decoded.includes("\ufffd")) out += run;
    else {
      out += decoded;
      fixed++;
    }
    i = j;
  }
  return { out, fixed };
}

const args = process.argv.slice(2);
const reportOnly = args.includes("--report");
const roots = args.filter((a) => !a.startsWith("--"));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css|md|json|html)$/.test(entry)) out.push(full);
  }
  return out;
}

let totalRuns = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    const before = readFileSync(file, "utf8");
    const { out, fixed } = repair(before);
    if (out === before) continue;
    totalRuns += fixed;
    if (reportOnly) {
      console.log(`  would repair ${fixed} run(s) in ${file}`);
    } else {
      writeFileSync(file, out, "utf8");
      console.log(`repaired ${fixed} run(s) in ${file}`);
    }
  }
}

console.log(
  totalRuns === 0
    ? "nothing to repair"
    : `${reportOnly ? "would repair" : "repaired"} ${totalRuns} run(s) total`,
);
