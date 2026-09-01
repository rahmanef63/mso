"use client";

import { useEffect, useState } from "react";
import { Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/os-shell";
import { useOsApi, fmtGiB, fmtUptime, type SysStats, type FsUsage } from "@/features/os-shell";
import { useAppearance, effectiveServerTarget } from "@/lib/appearance";
import { IS_DEMO } from "@/lib/demo";
import { SettingsSection, SettingsValueRow, SettingsActionRow } from "@/features/shell-settings";
import { MsoMark } from "@/components/shared/mso-mark";
import { WhatsNew } from "./whats-new";
import { UpdateSection } from "./update-section";
import pkg from "../../../../package.json";
import { openOnboarding } from "@/features/auth";

const APP_NAME = "Manef Shell OS";
const APP_TAGLINE = "Browser-based visual shell";

// Wipes appearance + device identity, then reloads fresh. Storage keys keep the
// historical "mso" prefix (changing them would orphan existing device ids).
function performReset() {
  try {
    localStorage.removeItem("mso:tweaks");
    localStorage.removeItem("mso.device.id");
    localStorage.removeItem("mso:demo-fs");
  } catch {
    /* private mode / quota */
  }
  window.location.reload();
}

export function AboutSection() {
  const api = useOsApi();
  const { tweaks } = useAppearance();
  const [stats, setStats] = useState<SysStats | null>(null);
  const [usage, setUsage] = useState<FsUsage | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

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

      <SettingsSection icon={<RotateCcw />} title="Reset">
        <SettingsActionRow
          label="Open onboarding"
          icon={<Info />}
          onClick={openOnboarding}
        />
        <SettingsActionRow
          label="Reset MSO"
          tone="destructive"
          icon={<RotateCcw />}
          onClick={() => setConfirmReset(true)}
        />
      </SettingsSection>

      <FormDrawer open={confirmReset} onOpenChange={setConfirmReset} size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>Reset MSO?</FormDrawer.Title>
          <FormDrawer.Description>
            Clears appearance + device identity, then reloads. Your files on disk are untouched.
          </FormDrawer.Description>
        </FormDrawer.Header>
        <FormDrawer.Footer>
          <Button type="button" variant="ghost" onClick={() => setConfirmReset(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setConfirmReset(false);
              performReset();
            }}
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </div>
  );
}
