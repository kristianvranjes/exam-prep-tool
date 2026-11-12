"use client";

import { AppearanceSettings, ThemeSelect } from "./theme";
import { PageHeader } from "./ui";

/** Settings (handoff 8c). The palette tiles and the live preview come with the settings redesign. */
export function SettingsPage() {
  return <section aria-labelledby="settings-heading">
    <PageHeader title="Postavke" headingId="settings-heading" />
    <div className="mt-8 max-w-xl space-y-6"><ThemeSelect /><AppearanceSettings /></div>
  </section>;
}
