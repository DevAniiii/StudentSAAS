import { clsx, type ClassValue } from "clsx";

/**
 * Conditional className composition.
 *
 * Deliberately thin. The design system lives in `globals.css` as Tailwind
 * utilities and a handful of composite classes; this exists so a component can
 * say "these classes, plus this one when the condition holds" without a
 * template literal nested three levels deep.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
