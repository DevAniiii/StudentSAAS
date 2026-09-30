import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * The wordmark: the supplied logo, plus the word set beside it.
 *
 * The logo is a raster file, which changes three things that a drawn SVG did not
 * care about, and each is handled deliberately rather than left to chance:
 *
 * - It is opaque. A JPEG has no alpha channel, so its background is part of the
 *   image and will not disappear against a dark theme. It is therefore laid on a
 *   white tile with a hairline ring, which reads as a deliberate plate in both
 *   themes instead of a white square punched out of a dark sidebar.
 * - It is fixed. Every caller gets the same file, so it lives in one place here
 *   rather than being imported at each of the three sites that show a logo.
 * - It has an intrinsic size. `width`/`height` are always passed so the browser
 *   reserves the box before the bytes arrive; the logo sits in the sidebar on
 *   every authenticated page, and an unsized image there shifts the whole nav.
 *
 * The word is kept as live text rather than baked into the artwork, because it is
 * the app's name and has to be selectable, translatable and readable by a screen
 * reader — none of which survives being flattened into a bitmap.
 *
 * The sweep is a one-shot reveal on first paint, not a loop. A logo that animates
 * forever is a logo nobody looks at; `prefers-reduced-motion` removes it via the
 * global reduced-motion block in the stylesheet.
 */
export function BrandMark({
  className,
  showWord = true,
  size = "md",
}: {
  className?: string;
  showWord?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  // The class sets the box; the number is the intrinsic size handed to the image
  // optimiser, which needs real pixels to pick a variant from.
  const pixels = { sm: 24, md: 32, lg: 40 }[size];
  const box = { sm: "size-6", md: "size-8", lg: "size-10" }[size];

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden
        className={cn("brand-mark relative grid shrink-0 place-items-center overflow-hidden", box)}
      >
        <Image
          src="/logo.jpeg"
          alt=""
          width={pixels}
          height={pixels}
          // Only the sign-in screen needs this before first paint; everywhere else
          // the logo is below the fold of nothing and marking it priority would
          // spend the user's bandwidth on an image they may never scroll to.
          priority={size === "lg"}
          className="size-full object-cover"
        />
      </span>

      {showWord ? (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[0.95rem] font-semibold tracking-[-0.03em] text-ink">
            ScholarFolio
          </span>
          <span className="mt-0.5 font-mono text-[0.5rem] uppercase tracking-[0.22em] text-ink-subtle">
            Student portal
          </span>
        </span>
      ) : null}
    </span>
  );
}