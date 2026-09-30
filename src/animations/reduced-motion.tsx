"use client";

import { useEffect, useState } from "react";

/**
 * Reduced-motion state.
 *
 * `prefers-reduced-motion: reduce` is a request, and the correct response is to
 * remove *movement*, not to remove *feedback*. A page where nothing moves at all
 * feels broken, because a state change with no transition reads as a jump cut.
 * So the rule throughout this app: under reduced motion, opacity crossfades are
 * kept at a short duration and every translation, scale, and scrub is removed.
 *
 * The hook subscribes rather than reading once, so a user who changes the
 * setting mid-session gets the new behaviour without a reload.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

let cached: MediaQueryList | null = null;
let wired = false;
const subscribers = new Set<(reduced: boolean) => void>();

function handleChange(event: MediaQueryListEvent): void {
  for (const notify of subscribers) notify(event.matches);
}

/** Subscribe once, lazily. `getQuery` runs on every render, so the listener
 *  must be registered at most once or a re-render would add another. */
function getQuery(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  cached ??= window.matchMedia(QUERY);
  if (!wired) {
    cached.addEventListener("change", handleChange);
    wired = true;
  }
  return cached;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  getQuery();
  return cached?.matches ?? false;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = getQuery();
    if (!query) return;
    setReduced(query.matches);
    subscribers.add(setReduced);
    return () => {
      subscribers.delete(setReduced);
    };
  }, []);

  return reduced;
}

/**
 * Durations for the current preference.
 *
 * Call sites read this instead of branching on `reduced` themselves, so the
 * reduced-motion path is a *shortened* animation rather than a special case that
 * has to be thought about separately. `null` means: do not animate at all.
 */
export function useMotionConfig() {
  const reduced = useReducedMotion();

  return {
    reduced,
    /**
     * Duration for a state change. Under reduced motion, a quick fade rather
     * than nothing, so the change is still perceptible.
     */
    transition: reduced ? 0.12 : undefined,
    /**
     * Whether GSAP should run a timeline at all, or snap to the end state.
     * Snapping is important: skipping the tween must leave the element in its
     * final state, not stranded mid-animation.
     */
    shouldAnimate: (respectsPreference = true) => !reduced || !respectsPreference,
    /** Y offset for entrances. Zero under reduced motion, since travel is the
     *  part that provokes vestibular symptoms. */
    travel: (px: number) => (reduced ? 0 : px),
    /** Stagger interval. Zero under reduced motion, so nothing appears to move
     *  in sequence. */
    stagger: (seconds: number) => (reduced ? 0 : seconds),
  };
}
