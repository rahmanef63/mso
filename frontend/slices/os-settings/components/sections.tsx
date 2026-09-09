"use client";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActiveShell } from "@/features/appshell";
import { DevicesPanel, useSession } from "@/features/auth";
import { SettingsSection } from "@/features/shell-settings";
import { cn } from "@/lib/utils";
import { Lock, ShieldCheck } from "lucide-react";
import { SECTIONS, type SectionId } from "../lib/sections";
import { A2ASection } from "./a2a-section";
import { AboutSection } from "./about-section";
import { AiSection } from "./ai-section";
import { AppearanceSection } from "./appearance-section";
import { AutoLockRow } from "./auto-lock-row";
import { BackupSection } from "./backup-section";
import { CleanupSection } from "./cleanup-section";
import { McpSection } from "./mcp-section";
import { MemorySection } from "./memory-section";
import { QuicklinksSection } from "./quicklinks-section";
import { ServerSection } from "./server-section";
import { ThemeSection } from "./theme-section";

// The section content — one functional panel per SectionId, shared verbatim by
// every shell's Settings layout (the per-shell seam only swaps the navigation
// chrome around these, never the bodies).
const OWNER_ONLY = new Set<SectionId>([
  "appearance",
  "theme",
  "ai",
  "quicklinks",
  "mcp",
  "a2a",
  "devices",
  "cleanup",
  "backup",
]);

export function SettingsSectionBody({ id }: { id: SectionId }) {
  const { status, role } = useSession();
  const privateSection = ["a2a", "devices", "cleanup", "ai"].includes(id);
  if (privateSection && status !== "in") return <SettingsSection icon={<Lock />} title="Sign in to manage this section">
    <p className="mb-3 text-sm text-muted-foreground">These controls require an Owner device on this server.</p>
    {status === "loading" ? <p role="status">Checking access…</p> : <Button asChild className="min-h-11"><Link prefetch={false} href="/login?returnTo=%2Fsettings">Sign in</Link></Button>}
  </SettingsSection>;
  if (status === "in" && role !== "owner" && OWNER_ONLY.has(id)) {
    return (
      <SettingsSection icon={<Lock />} title="Owner access required">
        <p className="text-sm leading-relaxed text-muted-foreground">
          This section changes shared workspace preferences, credentials, host
          state, access policy, or owner backups. The current{" "}
          <strong className="text-foreground">{role ?? "viewer"}</strong> device
          can use read-only workspace features but cannot open this control
          surface.
        </p>
      </SettingsSection>
    );
  }
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
    case "a2a":
      return <A2ASection />;
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
export function SectionDetail({
  id,
  showHeading = true,
}: {
  id: SectionId;
  showHeading?: boolean;
}) {
  const { id: shellId } = useActiveShell();
  const meta = SECTIONS.find((s) => s.id === id);
  return (
    <ScrollArea className="h-full">
      <div
        data-slot="settings-pane"
        className={cn("mx-auto min-w-0 max-w-3xl space-y-4 overflow-x-hidden p-3 pb-[max(1rem,var(--sai-bottom,0px))] sm:space-y-5 sm:p-5", shellId === "windows" && "sm:px-7 sm:pt-7")}
      >
        {showHeading && meta && (
          <header className="space-y-0.5">
            <h2
              className={cn(
                "leading-tight",
                shellId === "macos"
                  ? "text-xl font-semibold tracking-tight"
                  : shellId === "windows" ? "text-[28px] font-semibold tracking-tight" : "text-sm font-semibold",
              )}
            >
              {meta.label}
            </h2>
            <p className="text-xs text-muted-foreground">{meta.blurb}</p>
          </header>
        )}
        <SettingsSectionBody id={id} />
      </div>
    </ScrollArea>
  );
}
