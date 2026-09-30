"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DURATION, EASE, STAGGER, TRAVEL } from "./tokens";
import { useReducedMotion } from "./reduced-motion";

/**
 * Entrance and scroll-reveal primitives.
 *
 * Three rules hold for every animation in this file:
 *
 *  1. **The final state is the CSS default.** Animations run `from` a displaced
 *     state to the natural one, so an element with JavaScript disabled — or a
 *     hydration failure, or a print stylesheet — is already correct. Nothing
 *     depends on the animation running to become visible.
 *  2. **Every timeline is scoped and reverted.** `gsap.context()` per component
 *     means a route change cannot leave orphaned tweens writing to detached
 *     nodes, which is the usual cause of Next.js transition jank.
 *  3. **One axis, one distance, one duration.** Motion that comes from a
 *     consistent direction reads as a system; motion that varies reads as
 *     noise.
 */

/**
 * Register ScrollTrigger once per module instance.
 *
 * The check is on `window` rather than on GSAP's internals: `registerPlugin` is
 * idempotent, but it is not free, and running it at module scope keeps the
 * registration ahead of the first effect without needing a component to have
 * mounted. On the server the call is skipped — GSAP's plugin registry touches
 * `document` — and the client's first render registers it.
 */
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

interface RevealOptions {
  /** Delay before the element arrives. */
  delay?: number;
  /** Distance travelled. Set to 0 for a pure crossfade. */
  distance?: number;
  duration?: number;
  /** Trigger point, as a ScrollTrigger start string. */
  start?: string;
  /** Animate once (default) or every time it scrolls into view. */
  once?: boolean;
  as?: ElementType;
  className?: string;
}

/**
 * A single element that fades up into place.
 *
 * `threshold: 0.05` rather than the default — an element taller than the
 * viewport can never reach 100% visibility, so the default `0` fires before the
 * user has seen it and the reveal is missed entirely.
 */
export function Reveal({
  children,
  delay = 0,
  distance = TRAVEL.medium,
  duration,
  start = "top 88%",
  once = true,
  as: Tag = "div",
  className,
}: RevealOptions & { children: ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Nothing to do: the element is already in its final, correct position.
    if (reduced) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        element,
        { autoAlpha: 0, y: distance },
        {
          autoAlpha: 1,
          y: 0,
          duration: duration ?? DURATION.slower,
          delay,
          ease: EASE.outQuint,
          clearProps: "transform,opacity,visibility",
          scrollTrigger: { trigger: element, start, once },
        },
      );
    }, element);

    return () => context.revert();
    // `reduced` is intentionally a dependency: turning the setting on must stop
    // an in-flight animation rather than wait for it to land.
  }, [reduced, delay, distance, duration, start, once]);

  return (
    <Tag ref={ref as never} className={className}>
      {children}
    </Tag>
  );
}

interface StaggerOptions {
  /** Seconds between siblings. */
  step?: number;
  distance?: number;
  duration?: number;
  delay?: number;
  as?: ElementType;
  className?: string;
  /** Selector for the children to animate. Defaults to direct children. */
  selector?: string;
  start?: string;
}

/**
 * A group whose children arrive in sequence.
 *
 * Implemented as one timeline on a container rather than N independent
 * observers, because N observers produce N layout reads and a visible stutter on
 * long lists. ScrollTrigger batches them into a single refresh.
 */
export function Stagger({
  children,
  step = STAGGER.normal,
  distance = TRAVEL.short,
  duration,
  delay = 0,
  as: Tag = "div",
  className,
  selector = ":scope > *",
  start = "top 86%",
}: StaggerOptions & { children: ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    if (reduced) return;

    const targets = container.querySelectorAll<HTMLElement>(selector);
    if (targets.length === 0) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y: distance },
        {
          autoAlpha: 1,
          y: 0,
          duration: duration ?? DURATION.slow,
          delay,
          ease: EASE.outQuint,
          stagger: step,
          clearProps: "transform,opacity,visibility",
          scrollTrigger: { trigger: container, start, once: true },
        },
      );
    }, container);

    return () => context.revert();
  }, [reduced, step, distance, duration, delay, selector, start]);

  return (
    <Tag ref={ref as never} className={className}>
      {children}
    </Tag>
  );
}

interface CountUpOptions {
  value: number;
  duration?: number;
  decimals?: number;
  /** Rendered instead of the number once the count has settled. */
  format?: (value: number) => string;
  suffix?: string;
  className?: string;
  /** Skip the animation entirely — e.g. for `0`, which should just read `0`. */
  defer?: boolean;
}

/**
 * A figure that counts up to its value once, when it first scrolls into view.
 *
 * Only for figures that *changed* — a GPA, a term-progress percentage. A count-up
 * on a value that was always the same number is decoration, and decoration on a
 * ledger is noise. Pass `defer` to opt out, and the parent should do so when the
 * value is unchanged between renders.
 *
 * `snap` for zero, so a null-derived figure does not animate through a fake
 * intermediate value on its way to `0`.
 */
export function CountUp({
  value,
  duration,
  decimals = 0,
  format,
  suffix = "",
  className,
  defer = false,
}: CountUpOptions) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const reduced = useReducedMotion();
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (reduced || defer || !Number.isFinite(value)) {
      setSettled(value);
      return;
    }

    const render = (current: number) => {
      const text = format
        ? format(current)
        : current.toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          });
      element.textContent = `${text}${suffix}`;
    };

    const counter = { n: 0 };
    const context = gsap.context(() => {
      const tween = gsap.to(counter, {
        n: value,
        duration: duration ?? DURATION.deliberate,
        ease: EASE.outQuint,
        onUpdate: () => render(counter.n),
        onComplete: () => {
          render(value);
          setSettled(value);
        },
        snap: decimals === 0 ? { n: 1 } : undefined,
      });

      ScrollTrigger.create({
        trigger: element,
        start: "top 92%",
        once: true,
        onEnter: () => tween.play(),
      });
    }, element);

    return () => context.revert();
  }, [value, duration, decimals, format, suffix, reduced, defer]);

  // Server and first client render must agree, so the un-animated value is what
  // is emitted; the effect takes over from there.
  const text = format
    ? format(settled)
    : settled.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });

  return (
    <span ref={ref} className={className} aria-label={`${text}${suffix}`}>
      {`${text}${suffix}`}
    </span>
  );
}
