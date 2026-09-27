"use client";

import { ChevronRight, ShieldCheck } from "lucide-react";
import { useSession } from "@/features/auth";
import { SettingsActionRow, SettingsSection } from "@/features/shell-settings";
import type { SectionId } from "../lib/sections";
import { AccountPasswordCard } from "./account-password-card";
import { AccountProfileCard } from "./account-profile-card";
import { useAboutPage } from "./about-page-state";

export function AccountSection({ onOpen }: { onOpen: (id: SectionId) => void }) {
  const { status, role } = useSession();
  const { setPage } = useAboutPage();
  return (
    <div className="space-y-4 sm:space-y-5">
      <AccountProfileCard status={status} role={role} />
      <AccountPasswordCard status={status} role={role} />
      <SettingsSection icon={<ShieldCheck />} title="Also in Account" footnote="Devices and About live here. They are not separate Settings sections.">
        <SettingsActionRow label="Devices" onClick={() => onOpen("devices")} trailing={<ChevronRight className="size-4" aria-hidden />} />
        <SettingsActionRow label="About" onClick={() => { setPage("overview"); onOpen("about"); }} trailing={<ChevronRight className="size-4" aria-hidden />} />
      </SettingsSection>
    </div>
  );
}
