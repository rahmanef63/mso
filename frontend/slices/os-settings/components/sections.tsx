"use client";

import { Lock, ShieldCheck } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { DevicesPanel } from "@/features/auth";
import { useActiveShell } from "@/features/os-shell";
import { SettingsSection } from "@/features/shell-settings";
import { SECTIONS, type SectionId } from "../lib/sections";
import { AutoLockRow } from "./auto-lock-row";
import { AppearanceSection } from "./appearance-section";
import { ThemeSection } from "./theme-section";
import { AiSection } from "./ai-section";
import { MemorySection } from "./memory-section";
import { QuicklinksSection } from "./quicklinks-section";
import { McpSection } from "./mcp-section";
import { ServerSection } from "./server-section";
import { CleanupSection } from "./cleanup-section";
import { BackupSection } from "./backup-section";
import { AboutSection } from "./about-section";

// The section content — one functional panel per SectionId, shared verbatim by
// every shell's Settings layout (the per-shell seam only swaps the navigation
// chrome around these, never the bodies).
export function SettingsSectionBody({ id }: { id: SectionId }) {
  switch (id) {
    case "appearance":
      return <AppearanceSection />;
    case "theme":
      return <ThemeSection />;
    case "ai":
      return (
        <div className="space-y-4 sm:space-y-5">
          <AiSection />
          <MemorySection />
        </div>
      );
    case "quicklinks":
      return <QuicklinksSection />;
    case "mcp":
      return <McpSection />;
    case "devices":
      return (
        <div className="space-y-4 sm:space-y-5">
          <SettingsSection icon={<Lock />} title="Auto-Lock">
            <AutoLockRow />
          </SettingsSection>
          {/* bare: DevicesPanel brings its own cards — don't nest a card-in-card */}
          <SettingsSection
            icon={<ShieldCheck />}
            title="Approved devices"
            bare
            footnote="Each browser is a device gated by password + approval. Approve a pending device to grant it access; revoke to cut it off."
          >
            <DevicesPanel />
          </SettingsSection>
        </div>
      );
    case "server":
      return <ServerSection />;
    case "cleanup":
      return <CleanupSection />;
    case "backup":
      return <BackupSection />;
    case "about":
      return <AboutSection />;
  }
}

// One shared section body. Desktop renderers show a compact heading; mobile
// renderers normally suppress it because the shell-owned top bar carries the
// detail title. `showHeading` remains available for embedded/desktop contexts.
export function SectionDetail({ id, showHeading = true }: { id: SectionId; showHeading?: boolean }) {
  const { id: shellId } = useActiveShell();
  const meta = SECTIONS.find((s) => s.id === id);
  return (
    <ScrollArea className="h-full">
      <div data-slot="settings-pane" className="mx-auto min-w-0 max-w-3xl space-y-4 overflow-x-hidden p-3 pb-[max(1rem,var(--sai-bottom,0px))] sm:space-y-5 sm:p-5">
        {showHeading && meta && (
          <header className="space-y-0.5">
            <h2 className={cn("leading-tight", shellId === "macos" ? "text-[22px] font-bold tracking-tight" : "text-sm font-semibold")}>{meta.label}</h2>
            <p className="text-xs text-muted-foreground">{meta.blurb}</p>
          </header>
        )}
        <SettingsSectionBody id={id} />
      </div>
    </ScrollArea>
  );
}
