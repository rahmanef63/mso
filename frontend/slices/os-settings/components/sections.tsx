"use client";

import { ChevronRight, Lock, ShieldCheck } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { DevicesPanel } from "@/features/auth";
import { useActiveShell } from "@/features/os-shell";
import { SettingsSection } from "@/features/shell-settings";
import { SECTIONS, type SectionId } from "./nav";
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

// One scrolling section pane with its heading, adapting per shell (the dynamic
// per-shell seam): on iPhone a bold iOS large title (the section name — distinct
// from the shell nav bar's "Settings", so no double title); on macOS/Windows a
// compact title + blurb above the same shared grouped-card body.
export function SectionDetail({ id }: { id: SectionId }) {
  const { id: shellId, surface } = useActiveShell();
  const isPhone = surface === "mobile";
  const meta = SECTIONS.find((s) => s.id === id);
  return (
    <ScrollArea className="h-full">
      <div data-slot="settings-pane" className="mx-auto min-w-0 max-w-3xl space-y-4 overflow-x-hidden p-3 pb-[max(1rem,var(--sai-bottom,0px))] sm:space-y-5 sm:p-5">
        {meta &&
          (isPhone ? (
            // iOS large title (32/800, §3.9); Android keeps the 26px title.
            <h1 className={cn("px-1 pt-1 leading-none", shellId === "ios" ? "text-[32px] font-extrabold tracking-[-0.02em] pb-1" : "text-[26px] font-bold tracking-tight")}>{meta.label}</h1>
          ) : (
            <header className="space-y-0.5">
              <h2 className={cn("leading-tight", shellId === "macos" ? "text-[22px] font-bold tracking-tight" : "text-sm font-semibold")}>{meta.label}</h2>
              <p className="text-xs text-muted-foreground">{meta.blurb}</p>
            </header>
          ))}
        <SettingsSectionBody id={id} />
      </div>
    </ScrollArea>
  );
}

// Shared mobile fallback section index. Android uses this MasterDetail list; iOS
// owns a richer native root in ios-settings.tsx (large title + functional Search),
// so this stays deliberately generic rather than duplicating the iOS hierarchy.
export function SectionList({
  active,
  onSelect,
}: {
  active: SectionId | null;
  onSelect: (id: SectionId) => void;
}) {
  const { id: shellId } = useActiveShell();
  const ios = shellId === "ios";
  // Grouped cards echo iOS's visual grouping, bucketed by each section's
  // semantic `group` (personalization / services / system) — reorder-safe,
  // unlike an index slice. Consecutive same-group sections share a card.
  const groups = SECTIONS.reduce<(typeof SECTIONS)[number][][]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && last[0].group === s.group) last.push(s);
    else acc.push([s]);
    return acc;
  }, []);
  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      data-slot="settings-pane"
      className={cn(
        "mx-auto min-h-full max-w-2xl bg-muted/25 p-4 pb-[max(1rem,var(--sai-bottom,0px))]",
        ios ? "space-y-[18px]" : "space-y-6",
      )}
    >
      {groups.map((group, gi) => (
        <div key={gi} data-slot="settings-card" className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
          {group.map((s) => {
            const Icon = s.icon;
            const on = s.id === active;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-slot="settings-row"
                onClick={() => onSelect(s.id)}
                className={cn(
                  "relative flex w-full items-center gap-3 px-4 text-left transition-colors",
                  ios ? "min-h-[46px] py-[11px]" : "py-2.5",
                  "after:absolute after:inset-x-0 after:bottom-0 after:left-[3.5rem] after:h-px after:bg-border/60 last:after:hidden",
                  on ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span
                  className="grid size-[29px] shrink-0 place-items-center rounded-[7px] shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                  style={{ background: s.color }}
                >
                  <Icon className="size-[17px] text-white" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[16px] font-medium leading-tight">{s.label}</span>
                <ChevronRight className={cn("shrink-0", ios ? "size-[15px] text-muted-foreground/40" : "size-[18px] text-muted-foreground/45")} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
