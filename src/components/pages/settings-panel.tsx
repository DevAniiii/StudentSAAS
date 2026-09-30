"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/field";
import { useTheme, type DensitySetting, type ThemeSetting } from "@/components/shell/theme";
import { useToast } from "@/components/ui/toast";

/**
 * Appearance.
 *
 * Theme and density, both applied immediately and persisted in the background.
 *
 * The theme is a three-way choice here and a two-way toggle in the topbar, and
 * that difference is deliberate: a single button should never cycle through a
 * value the student did not ask for, but in a settings page where the options are
 * all visible, "match my system" is exactly the kind of thing people want and
 * never find. `SYSTEM` is only reachable from this page.
 *
 * Density is the other half of appearance and it is genuinely load-bearing rather
 * than a preference for its own sake: `COMPACT` tightens the vertical rhythm
 * across every panel, row and field, which on a laptop in a lecture is the
 * difference between seeing four assignments or six.
 *
 * The live preview of the palette sits below the controls on purpose — the whole
 * value of a theme picker is seeing it work before choosing it.
 */

const THEMES: { value: ThemeSetting; label: string; hint: string }[] = [
  { value: "LIGHT", label: "Light", hint: "Warm paper, always" },
  { value: "DARK", label: "Dark", hint: "Chalk on slate" },
  { value: "SYSTEM", label: "System", hint: "Follow your device" },
];

const DENSITIES: { value: DensitySetting; label: string; hint: string }[] = [
  { value: "COMFORTABLE", label: "Comfortable", hint: "More air between rows" },
  { value: "COMPACT", label: "Compact", hint: "More rows on screen" },
];

export function SettingsPanel() {
  /*
   * Both values come from the theme context, not from props.
   *
   * An earlier version took `theme` and `density` as props from the server and
   * read only `density` from them, which meant the persist calls sent a stale
   * server value: change the density, then change the theme, and the second
   * PATCH would write back the density the server last knew about, silently
   * undoing the first change. Reading both from the one context that owns them
   * removes the possibility rather than the symptom, and it means the panel has
   * no props at all — there is nothing about appearance that only the server
   * knows, because the context hydrates from the same localStorage the blocking
   * bootstrap script in `layout.tsx` reads.
   */
  const { setting, density, setSetting, setDensity } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  /**
   * Persist a preference.
   *
   * `router.refresh()` afterwards rather than reading the response into state:
   * the local value is already applied and there is nothing to reflect, but the
   * server-rendered sidebar reads `weekStartsOn` and the timetable order, so a
   * refresh is needed for those to catch up.
   */
  const persist = useCallback(
    async (body: Record<string, string>) => {
      setSaving(true);
      try {
        const response = await fetch("/api/v1/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(String(response.status));
        toast.success("Saved", "Your preference follows you to your other devices.");
        router.refresh();
      } catch {
        // The local change stands and is still on this device; saying so is more
        // useful than a generic failure, because nothing is actually broken.
        toast.error(
          "Saved on this device only",
          "We could not reach your account, so this preference has not been carried across. It will sync the next time a change saves.",
        );
      } finally {
        setSaving(false);
      }
    },
    [router, toast],
  );

  return (
    <Panel as="section" aria-labelledby="appearance" aria-busy={saving}>
      <PanelHeader
        id="appearance"
        title="Appearance"
        description="Applied to this device straight away, and saved to your account so it follows you."
      />

      <div className="grid gap-x-8 gap-y-5 px-4 py-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">
            Theme
          </p>
          <SegmentedControl
            name="theme"
            ariaLabel="Colour theme"
            value={setting}
            onChange={(next) => {
              setSetting(next);
              void persist({ theme: next, density });
            }}
            options={THEMES.map((option) => ({
              value: option.value,
              label: (
                <span title={option.hint}>
                  {option.label}
                  {option.value === "SYSTEM" ? (
                    <span className="ml-1 font-mono text-2xs text-ink-subtle">auto</span>
                  ) : null}
                </span>
              ),
            }))}
          />
          <p className="mt-2 text-2xs leading-relaxed text-ink-muted">
            {setting === "SYSTEM"
              ? "Following your device's appearance. Change it in your operating system's settings and ScholarFolio follows."
              : `Always ${setting === "LIGHT" ? "light" : "dark"}, whatever your device is set to.`}
          </p>
        </div>

        <div>
          <p className="mb-2 font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">
            Density
          </p>
          <SegmentedControl
            name="density"
            ariaLabel="Row density"
            value={density}
            onChange={(next) => {
              setDensity(next);
              void persist({ density: next, theme: setting });
            }}
            options={DENSITIES.map((option) => ({
              value: option.value,
              label: <span title={option.hint}>{option.label}</span>,
            }))}
          />
          <p className="mt-2 text-2xs leading-relaxed text-ink-muted">
            Compact tightens every list, panel and field. Useful on a small screen or in a
            lecture, where the difference is a couple more rows of a table.
          </p>
        </div>
      </div>

      <div className="border-t border-rule px-4 py-3">
        <p className="mb-2.5 font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">
          The palette, in use
        </p>
        <PalettePreview />
      </div>
    </Panel>
  );
}

/**
 * A live sample of the palette.
 *
 * Every token the pages actually use, shown as a swatch with its name. This
 * exists because a theme picker that only shows a page-sized mock-up is asking the
 * student to imagine; showing the eleven colours side by side answers "is the
 * ochre readable on this?" without a click.
 */
function PalettePreview() {
  // These name the raw custom properties from `:root`, not the Tailwind theme
  // slots. They look interchangeable but are not: the slots are `--color-*` and
  // are consumed as utility classes, while nothing here would resolve if a slot
  // name were used against `var()` and the swatch would silently paint nothing.
  const swatches = [
    { token: "--paper", label: "Page", use: "page background" },
    { token: "--paper-raised", label: "Panel", use: "raised surfaces" },
    { token: "--rule", label: "Rule", use: "borders" },
    { token: "--ink", label: "Ink", use: "body text" },
    { token: "--ink-muted", label: "Muted", use: "secondary text" },
    { token: "--accent", label: "Accent", use: "primary, selected" },
    { token: "--ochre", label: "Amber", use: "attention" },
    { token: "--vermilion", label: "Red", use: "overdue, errors" },
    { token: "--slate", label: "Sky", use: "informational" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {swatches.map((swatch) => (
        <div key={swatch.token} className="w-[6.5rem] shrink-0">
          <div
            className="h-8 w-full rounded-sm ring-1 ring-inset ring-rule"
            style={{ background: `var(${swatch.token})` }}
          />
          <p className="mt-1 truncate text-2xs font-medium text-ink">{swatch.label}</p>
          <p className="truncate text-[0.6rem] text-ink-subtle">{swatch.use}</p>
        </div>
      ))}
    </div>
  );
}

