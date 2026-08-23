"use client";

import { AppFrame, usePublishMobileNavigation, useShellDesign } from "@/features/os-shell";
import type { SectionId } from "../lib/sections";
import { settingsSection } from "../lib/sections";
import { SettingsSidebar, SettingsTabs } from "./nav";
import { IosSettings } from "./ios-settings";
import { SectionDetail } from "./sections";
import { AndroidSettingsIndex } from "./android-settings";

export function SettingsShell({ active, onSelect }: { active: SectionId | null; onSelect: (id: SectionId | null) => void }) {
  const design = useShellDesign();
  const detail = active ? settingsSection(active) : null;
  const mobile = design.mobileNavigation !== "none";

  usePublishMobileNavigation(
    "os-settings",
    mobile && detail ? { title: detail.label, backLabel: "Settings", onBack: () => onSelect(null) } : null,
    [mobile, detail?.id, detail?.label, onSelect],
  );

  if (design.settingsNavigation === "ios-stack") {
    return (
      <AppFrame safeArea={false} bodyClassName="overflow-hidden">
        <IosSettings active={active} onSelect={(id) => onSelect(id)} />
      </AppFrame>
    );
  }

  if (design.settingsNavigation === "android-stack") {
    return (
      <AppFrame safeArea={false} bodyClassName="overflow-hidden bg-background">
        {active ? <SectionDetail id={active} showHeading={false} /> : <AndroidSettingsIndex onSelect={(id) => onSelect(id)} />}
      </AppFrame>
    );
  }

  const desktopActive: SectionId = active ?? "appearance";
  if (design.settingsNavigation === "macos-sidebar") {
    return (
      <AppFrame>
        <div className="flex h-full min-h-0">
          <aside className="w-56 shrink-0 border-r border-border bg-sidebar/40">
            <SettingsSidebar active={desktopActive} onSelect={(id) => onSelect(id)} />
          </aside>
          <div className="min-w-0 flex-1"><SectionDetail id={desktopActive} /></div>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame toolbar={<div className="bg-sidebar/40"><SettingsTabs active={desktopActive} onSelect={(id) => onSelect(id)} /></div>}>
      <SectionDetail id={desktopActive} />
    </AppFrame>
  );
}
