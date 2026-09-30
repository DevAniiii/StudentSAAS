/**
 * Motion tokens.
 *
 * These mirror the durations and curves in `globals.css` exactly. Keeping the
 * ladder in one place in CSS and one place here is a deliberate duplication:
 * CSS owns what a stylesheet transition does, and this module owns what GSAP
 * does. A single source of truth would mean reading computed styles inside an
 * animation, which is both slow and fragile.
 *
 * The vocabulary is the app's own, not arbitrary numbers:
 *
 *   instant     60ms  acknowledgement of a press
 *   fast        130ms hover, focus, colour
 *   base        200ms small element state change
 *   slow        320ms panel, popover
 *   slower      480ms full-surface transition
 *   deliberate  720ms the signature spine, and nothing else
 *
 * "Deliberate" is the discipline that matters. A transition slower than ~400ms
 * on a control reads as lag, not as craft, so nothing below `slower` is used
 * except the one interaction the whole design language is built around.
 */

export const DURATION = {
  instant: 0.06,
  fast: 0.13,
  base: 0.2,
  slow: 0.32,
  slower: 0.48,
  deliberate: 0.72,
} as const;

export const EASE = {
  /** Default for anything entering or leaving. Decisive, minimal overshoot. */
  outQuint: "power3.out",
  /** For exits. Accelerates away rather than easing into stillness. */
  inQuad: "power2.in",
  /** For anything that moves and settles — pips, dials, panels. */
  inOutQuart: "power3.inOut",
  /** Long signature moves: the spine sweep, route curtains. */
  ledger: "power4.out",
  /** The single place overshoot is allowed: a figure landing on its value. */
  pop: "back.out(1.7)",
} as const;

export type DurationToken = keyof typeof DURATION;
export type EaseToken = keyof typeof EASE;

/** Standard stagger. Enough separation to read as sequence, not as a wave. */
export const STAGGER = {
  /** Siblings appearing together — 30ms is below the threshold where a group
   *  starts to feel sequential rather than simultaneous. */
  tight: 0.03,
  /** Cards in a grid or rows in a list. */
  normal: 0.055,
  /** A short, deliberate sequence such as page furniture. */
  loose: 0.09,
} as const;

/** Distances. Everything enters along one axis, never diagonally. */
export const TRAVEL = {
  /** Rows, list items, table cells. */
  short: 8,
  /** Cards and panels. */
  medium: 14,
  /** Page-level entrances. */
  long: 24,
} as const;
