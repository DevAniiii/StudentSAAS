"use client";

import { useEffect, type ReactNode } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "./reduced-motion";

/**
 * Scroll and animation runtime.
 *
 * Mounted once, at the root, before any animated content. It owns three things
 * that must not be owned by a page:
 *
 *  1. **Lenis.** Smooth scrolling, but only when the user has not asked for
 *     reduced motion and only on a pointer that can hover. On a touch device
 *     Lenis fights the platform's own momentum scrolling and produces a laggy,
 *     slightly wrong-feeling page, so it is not mounted at all.
 *  2. **The GSAP↔Lenis frame loop.** Without `lagSmoothing` and a `scroll`
 *     trigger, ScrollTrigger positions are computed against a stale scroll value
 *     and everything is half a frame behind the page.
 *  3. **ScrollTrigger teardown.** Route changes unmount subtrees; any
 *     ScrollTrigger left attached to removed nodes keeps a reference to them and
 *     fires against a detached element. React 19's Strict Mode double-invokes
 *     effects, so the provider listens for `astro:page-load`-equivalent events
 *     and purges on unmount.
 */

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();

  useEffect(() => {
    // Reduced motion: no smooth scroll, and no scrubbed ScrollTriggers. The
    // reveal animations already handle their own opt-out, so they keep working.
    if (reduced) return;

    const finePointer = window.matchMedia("(pointer: fine)");
    if (!finePointer.matches) return;

    const lenis = new Lenis({
      duration: 0.9,
      // Decelerating curve rather than a linear tween: a linear scroll wheel
      // feels like a conveyor belt, a long tail feels like momentum.
      easing: (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      // A touchpad already reports velocity. Lenis extrapolating from it is
      // what makes trackpad scrolling feel worse than native, so trust it.
      syncTouch: false,
    });

    lenis.on("scroll", ScrollTrigger.update);

    // Published on `window` so `scrollTo` — and any third-party component that
    // wants to drive the scroller — can reach the running instance instead of
    // each reimplementing smooth scrolling differently.
    const globals = window as typeof window & { lenis?: Lenis };
    globals.lenis = lenis;

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(raf);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      delete globals.lenis;
    };
  }, [reduced]);

  useEffect(() => {
    // Fonts change text metrics, which changes every element's height, which
    // invalidates every cached trigger position. Without this, reveals fire at
    // the wrong scroll offsets on a slow connection.
    let cancelled = false;
    document.fonts?.ready
      .then(() => {
        if (!cancelled) ScrollTrigger.refresh();
      })
      .catch(() => {});

    // Content height also changes without a font or resize event — a thread
    // being opened, an accordion expanding. One observer on <body> covers all of
    // it, and `ScrollTrigger.refresh` is idempotent and cheap enough at this
    // rate.
    const observer = new ResizeObserver(() => ScrollTrigger.refresh());
    observer.observe(document.body);

    return () => {
      cancelled = true;
      observer.disconnect();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    };
  }, []);

  return <>{children}</>;
}

/**
 * Scroll a Lenis instance to an element or offset, when one exists.
 *
 * Falls back to the platform's own `scrollIntoView` when Lenis is not running,
 * so anchors and in-page navigation work in both modes and under reduced motion.
 */
export function scrollTo(target: string | number, options?: { offset?: number }): void {
  if (typeof window === "undefined") return;
  const offset = options?.offset ?? -88; // clears the sticky topbar

  const element =
    typeof target === "string" ? document.querySelector<HTMLElement>(target) : null;

  if (element) {
    const top = element.getBoundingClientRect().top + window.scrollY + offset;
    const lenis = (window as unknown as { lenis?: Lenis }).lenis;
    if (lenis) {
      lenis.scrollTo(top, { duration: 0.7 });
      return;
    }
    window.scrollTo({ top, behavior: "smooth" });
    return;
  }

  const absolute = typeof target === "number" ? target : 0;
  const lenis = (window as unknown as { lenis?: Lenis }).lenis;
  if (lenis) {
    lenis.scrollTo(absolute, { duration: 0.7 });
    return;
  }
  window.scrollTo({ top: absolute, behavior: "smooth" });
}
