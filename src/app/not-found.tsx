import type { Metadata } from "next";
import { NotFoundState } from "@/components/ui/states";
import { BrandMark } from "@/components/shell/brand-mark";

export const metadata: Metadata = { title: "Not found" };

/**
 * 404, in the app's own voice.
 *
 * Next's built-in not-found page is a bare "404 | This page could not be found"
 * with no styling and no way back. A student who mistypes a URL, or follows a
 * stale link from an email the registrar sent last term, lands here — and the
 * default page reads as a broken site rather than as a wrong address.
 *
 * It renders inside the root layout, so it gets the fonts, the theme, and the
 * theme script: on a machine set to dark, a flash of white page would be the
 * first thing seen.
 *
 * `NotFoundState` is the same component the inline screens use for a missing
 * record, deliberately. "That assessment is gone" and "that address is wrong" are
 * the same message to a reader, and having two would mean one of them drifts.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>

        <NotFoundState
          title="That address is not part of your portal"
          description="Check the address, or start from Today. Links to records from a previous term stop working once a term closes, so an older email is a likely cause."
          action={{ label: "Back to Today", href: "/today" }}
        />
      </div>
    </main>
  );
}
