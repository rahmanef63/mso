"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { useOsApi, type SysStats, type FsUsage } from "@/features/appshell";
import { fmtGiB, fmtUptime } from "@/lib/os-api/format";
import { useAppearance, effectiveServerTarget } from "@/lib/appearance";
import { IS_DEMO } from "@/lib/demo";
import { SettingsSection, SettingsValueRow, SettingsActionRow } from "@/features/shell-settings";
import { MsoMark } from "@/components/shared/mso-mark";
import { WhatsNew } from "./whats-new";
import { UpdateSection } from "./update-section";
import { MaintenanceSection } from "./maintenance-section";
import pkg from "../../../../package.json";
import { openOnboarding } from "@/features/auth";

const APP_NAME = "Manef Shell OS";
const APP_TAGLINE = "Browser-based visual shell";

export function AboutSection() {
  const api = useOsApi();
  const { tweaks } = useAppearance();
  const [stats, setStats] = useState<SysStats | null>(null);
  const [usage, setUsage] = useState<FsUsage | null>(null);

  // Stats are MOCK when the active target is mock/demo — flag it so About never
  // presents invented machine specs as the real host (VPS-essence honesty).
  const isSample = IS_DEMO || effectiveServerTarget(tweaks.server, IS_DEMO)?.kind === "mock";

  useEffect(() => {
    let alive = true;
    Promise.all([api.sys.stats(), api.fs.usage()])
      .then(([s, u]) => {
        if (!alive) return;
        setStats(s);
        setUsage(u);
      })
      .catch(() => {
        /* leave placeholders */
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const rows: [string, string][] = [
    ["Status", "Public Alpha"],
    ["App version", pkg.version ?? "0.0.0"],
    ["Build ID", process.env.NEXT_PUBLIC_BUILD_ID || "dev"],
    ["Commit", process.env.NEXT_PUBLIC_COMMIT_SHA || "not set"],
    ["Runtime mode", IS_DEMO ? "Demo — mock data only" : "Live-capable"],
    ["Cores", stats ? String(stats.cpu.cores) : "—"],
    ["Memory", stats ? fmtGiB(stats.mem.total) : "—"],
    ["Disk", stats ? fmtGiB(stats.disk.total) : "—"],
    ["Uptime", stats ? fmtUptime(stats.uptime) : "—"],
    ["Storage used", usage ? `${fmtGiB(usage.used)} of ${fmtGiB(usage.total)}` : "—"],
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* About-This-Mac style identity header — above the grouped cards */}
      <div className="flex flex-col items-center gap-2 pt-1 text-center">
        <MsoMark className="size-16 shell-icon-tile" />
        <div>
          <div className="text-lg font-bold tracking-tight text-foreground">{APP_NAME}</div>
          <div className="text-xs text-muted-foreground">{APP_TAGLINE}</div>
        </div>
      </div>

      <SettingsSection
        icon={<Info />}
        title="System"
        footnote={isSample ? "Sample data — connect a live host in Server for real specs." : undefined}
      >
        {rows.map(([k, v]) => (
          <SettingsValueRow key={k} label={k} value={v} />
        ))}
      </SettingsSection>

      {/* Above "What's new": the update is the thing to ACT on, the changelog is the
          thing to read. Renders nothing in demo, or where the host cannot self-update. */}
      <UpdateSection />

      <WhatsNew />

      <SettingsSection icon={<Info />} title="Setup">
        <SettingsActionRow label="Open onboarding" icon={<Info />} onClick={openOnboarding} />
      </SettingsSection>
      <MaintenanceSection />
    </div>
  );
}
