"use client";

import { Info } from "lucide-react";
import { openOnboarding } from "@/features/auth";
import { SettingsActionRow, SettingsFeatureCell, SettingsSection } from "@/features/shell-settings";
import { IS_DEMO } from "@/lib/demo";
import { aboutBreadcrumbs } from "../lib/about-pages";
import type { SectionId } from "../lib/sections";
import { AboutOverview } from "./about-overview";
import { useAboutPage } from "./about-page-state";
import { MaintenanceSection } from "./maintenance-section";
import { UpdateSection } from "./update-section";
import { VersionSection } from "./version-section";
import { WhatsNew } from "./whats-new";

export function AboutSection({ onOpen }: { onOpen?: (id: SectionId) => void }) {
  const { page, setPage } = useAboutPage();
  return (
    <SettingsFeatureCell breadcrumbs={aboutBreadcrumbs(page, {
      onAccount: onOpen ? () => onOpen("account") : undefined,
      onAbout: () => setPage("overview"),
    })}>
      {page === "overview" ? <AboutOverview onOpenPage={setPage} /> : null}
      {page === "version" ? <VersionSection /> : null}
      {page === "updates" ? <AboutUpdates /> : null}
      {page === "whats-new" ? <WhatsNew /> : null}
      {page === "maintenance" ? <AboutMaintenance /> : null}
    </SettingsFeatureCell>
  );
}

function AboutUpdates() {
  if (IS_DEMO) {
    return (
      <SettingsSection icon={<Info />} title="Updates" footnote="This demo does not apply software updates.">
        <p className="px-4 py-3 text-sm text-muted-foreground">Software updates run on a live host from this page or with mso update.</p>
      </SettingsSection>
    );
  }
  return <UpdateSection />;
}

function AboutMaintenance() {
  return (
    <div className="space-y-4 sm:space-y-5">
      <SettingsSection icon={<Info />} title="Setup" footnote="Reopen the guided setup without resetting existing configuration.">
        <SettingsActionRow label="Open onboarding" icon={<Info />} onClick={openOnboarding} />
      </SettingsSection>
      <MaintenanceSection />
    </div>
  );
}
