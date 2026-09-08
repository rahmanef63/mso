"use client";

import { useState } from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppSidebar, AppFrame, usePublishMobileNavigation, useShellDesign } from "@/features/appshell";
import type { SectionId } from "../lib/sections";
import { settingsSection } from "../lib/sections";
import { SettingsSidebar, SettingsTabs } from "./nav";
import { IosSettings } from "./ios-settings";
import { SectionDetail } from "./sections";
import { AndroidSettingsIndex } from "./android-settings";

export function SettingsShell({ active, onSelect }: { active: SectionId | null; onSelect: (id: SectionId | null) => void }) {
  const design = useShellDesign();
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  if (design.settingsNavigation === "macos-sidebar" || design.settingsNavigation === "windows-sidebar") {
    return (
      <div className="flex h-full min-h-0 bg-muted/30">
        <AppSidebar open={sidebarOpen} onOpenChange={setSidebarOpen} title="Settings sections"
          railClassName={design.id === "windows" ? "w-64 border-r-0 bg-[var(--mica-win,var(--sidebar))]" : "w-56 bg-sidebar/70"}>
          <SettingsSidebar windows={design.id === "windows"} active={desktopActive} onSelect={(id) => { onSelect(id); setSidebarOpen(false); }} />
        </AppSidebar>
        <AppFrame className="min-w-0 flex-1" toolbar={<div className="hidden border-b border-border p-1 @max-[600px]:block">
          <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(true)}><PanelLeft className="size-4" /> Settings sections</Button>
        </div>}>
          <SectionDetail id={desktopActive} />
        </AppFrame>
      </div>
    );
  }

  return (
    <AppFrame toolbar={<div className="bg-sidebar/40"><SettingsTabs active={desktopActive} onSelect={(id) => onSelect(id)} /></div>}>
      <SectionDetail id={desktopActive} />
    </AppFrame>
  );
}
