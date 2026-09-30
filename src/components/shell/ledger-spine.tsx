"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/animations/reduced-motion";

/**
 * The Ledger Spine — the app's signature interaction.
 *
 * A ruled term ruler in the topbar. Not decoration: it is the only place in the
 * product where the *shape of the term* is visible at all. Everything else is a
 * list of items; the spine is the one element that says "you are here, in week
 * seven of sixteen, and this is when that changes."
 *
 * What it carries:
 *
 *  - a **travelling "now" pip**, so time is something you watch move rather
 *    than something you re-read
 *  - **deadline notches** on the track, so a due date is a position in the term
 *    and not just a row in a list
 *  - **week rulings** at major boundaries, matching the ruled-paper language
 *
 * What it deliberately does not do: it is not a chart, it does not encode
 * magnitude on a scale the viewer has to learn, and it never moves on its own
 * faster than the eye can follow. The one long animation in the whole app — the
 * pip travelling when you jump weeks — is `deliberate`, and it is skipped
 * entirely under reduced motion.
 *
 * Under reduced motion the pip is placed directly at its position. The
 * information is identical; only the journey is removed.
 */

export interface SpineNotch {
  id: string;
  /** 0–1 across the term. */
  position: number;
  label: string;
  state: "done" | "due" | "overdue" | "neutral";
}

export interface SpineProps {
  /** 0–1 across the whole term. */
  progress: number;
  week: number;
  weekCount: number;
  /**
   * No `weekStartsOn`. The ruler is laid out in *term* weeks, and a term's week
   * one is the institute's teaching week, not the reader's. A student who keeps
   * Sunday as their personal week start still has to attend the Monday this
   * ruler is counting from, so honouring the preference here would put the "now"
   * pip in the wrong place. The preference is applied where it does belong — the
   * timetable's column order on the term page.
   */
  notches?: SpineNotch[];
  /** Term label shown in the expanded view. */
  termName?: string;
  daysRemaining?: number;
  /** Compact: a single line under the topbar. Expanded: a full panel. */
  variant?: "mini" | "full";
  className?: string;
}

export function LedgerSpine({
  progress,
  week,
  weekCount,
  notches = [],
  termName,
  daysRemaining,
  variant = "mini",
  className,
}: SpineProps) {
  const reduced = useReducedMotion();
  const pipRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [settled, setSettled] = useState(progress);

  // Track width is needed to animate the pip in *pixels*. Animating a percentage
  // looks correct but is wrong whenever the container resizes mid-flight — the
  // pip arrives at the wrong place, which on a time ruler is the one bug that
  // makes the whole thing feel decorative.
  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;

    const measure = () => setWidth(element.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pip = pipRef.current;
    if (!pip) return;

    if (reduced || width === 0) {
      // No journey: land immediately.
      pip.style.left = `${Math.min(Math.max(progress, 0), 1) * 100}%`;
      setSettled(progress);
      return;
    }

    const from = Math.min(Math.max(settled, 0), 1) * width;
    const to = Math.min(Math.max(progress, 0), 1) * width;
    if (Math.abs(to - from) < 0.5) {
      setSettled(progress);
      return;
    }

    // The one long move in the app, and the only animation here allowed to take
    // `deliberate`. Web Animations rather than GSAP: this runs once per
    // navigation on a single element, so a tween library would be overhead.
    const animation = pip.animate(
      [{ left: `${from}px` }, { left: `${to}px` }],
      {
        duration: 720,
        // Decelerating, matching --curv-out-quint closely enough at this scale
        // that the two do not need to be the same number.
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      },
    );

    animation.finished
      .then(() => setSettled(progress))
      .catch(() => setSettled(progress));

    return () => {
      animation.cancel();
    };
  }, [progress, settled, width, reduced]);

  const clamped = Math.min(Math.max(progress, 0), 1);
  const percent = Math.round(clamped * 100);

  if (variant === "mini") {
    return (
      <div className={cn("spine spine--mini", className)}>
        <div
          ref={trackRef}
          className="spine__track"
          role="img"
          aria-label={
            termName
              ? `Term progress: week ${week} of ${weekCount}, ${percent} per cent elapsed.`
              : `Term progress: ${percent} per cent elapsed.`
          }
        >
          <div className="spine__elapsed" style={{ width: `${percent}%` }} />

          {notches.map((notch) => (
            <span
              key={notch.id}
              className={cn(
                "spine__notch",
                notch.state === "due" && "spine__notch--due",
                notch.state === "overdue" && "spine__notch--overdue",
                notch.state === "done" && "spine__notch--done",
              )}
              style={{ left: `${Math.min(Math.max(notch.position, 0), 1) * 100}%` }}
            >
              <span className="sr-only">{notch.label}</span>
            </span>
          ))}

          <span ref={pipRef} className="spine__now" style={{ left: `${percent}%` }} />
        </div>
      </div>
    );
  }

  // Expanded: the full ruler, with week numbers and a caption.
  const weekPosition = weekCount > 0 ? (week - 1) / Math.max(weekCount - 1, 1) : 0;
  const majorEvery = weekCount > 12 ? 4 : 2;

  return (
    <div className={cn("spine spine--full", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-ink-subtle">
          {termName ?? "Term"}
        </p>
        <p className="font-mono text-2xs tabular-nums text-ink-muted">
          Week {week} / {weekCount}
        </p>
      </div>

      <div
        ref={trackRef}
        className="spine__track mt-2"
        role="img"
        aria-label={`${termName ?? "Term"}: week ${week} of ${weekCount}. ${percent} per cent elapsed.${
          daysRemaining !== undefined ? ` ${daysRemaining} days remaining.` : ""
        }`}
      >
        <div className="spine__elapsed" style={{ width: `${percent}%` }} />

        {Array.from({ length: weekCount }, (_, index) => {
          const number = index + 1;
          const isMajor = number % majorEvery === 0 || number === 1 || number === weekCount;
          return (
            <span
              key={number}
              aria-hidden
              className={cn("spine__week", isMajor && "spine__week--major")}
              style={{ left: `${(index / Math.max(weekCount - 1, 1)) * 100}%` }}
            />
          );
        })}

        {notches.map((notch) => (
          <span
            key={notch.id}
            aria-hidden
            className={cn(
              "spine__notch",
              notch.state === "due" && "spine__notch--due",
              notch.state === "overdue" && "spine__notch--overdue",
              notch.state === "done" && "spine__notch--done",
            )}
            style={{ left: `${Math.min(Math.max(notch.position, 0), 1) * 100}%` }}
          />
        ))}

        <span
          ref={pipRef}
          className="spine__now"
          style={{ left: `${Math.min(Math.max(weekPosition, 0), 1) * 100}%` }}
        />
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-2xs tabular-nums text-ink-subtle">
        <span>W1</span>
        <span>
          {percent}% elapsed
          {daysRemaining !== undefined && daysRemaining > 0
            ? ` · ${daysRemaining}d left`
            : ""}
        </span>
        <span>W{weekCount}</span>
      </div>
    </div>
  );
}

/** Deadline positions for the spine, derived from term maths. */
export function buildNotches(input: {
  termStart: Date;
  termEnd: Date;
  deadlines: { id: string; at: Date; state: SpineNotch["state"]; label: string }[];
}): SpineNotch[] {
  const total = input.termEnd.getTime() - input.termStart.getTime();
  if (total <= 0) return [];

  return input.deadlines.map((deadline) => ({
    id: deadline.id,
    position: (deadline.at.getTime() - input.termStart.getTime()) / total,
    label: deadline.label,
    state: deadline.state,
  }));
}
