"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { MsoMark } from "@/components/shared/mso-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { openOnboarding } from "@/features/auth";
import { useOsApi, type FsUsage, type SysStats } from "@/features/appshell";
import {
  SettingsActionRow,
  SettingsSection,
  SettingsValueRow,
} from "@/features/shell-settings";
import { effectiveServerTarget, useAppearance } from "@/lib/appearance";
import { IS_DEMO } from "@/lib/demo";
import { fmtGiB, fmtUptime } from "@/lib/os-api/format";
import pkg from "../../../../package.json";
import { MaintenanceSection } from "./maintenance-section";
import { UpdateSection } from "./update-section";
import { WhatsNew } from "./whats-new";

const APP_NAME = "Manef Shell OS";
const APP_TAGLINE = "Browser-based visual shell";

type AboutTab = "overview" | "update" | "whats-new" | "maintenance";

const ABOUT_TABS: ReadonlyArray<{ id: AboutTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "update", label: "Update" },
  { id: "whats-new", label: "What's new" },
  { id: "maintenance", label: "Maintenance" },
];

function ValueSkeleton({ width = "w-20" }: { width?: string }) {
  return <Skeleton className={`ml-auto h-3.5 ${width}`} />;
}

export function AboutSection() {
  const api = useOsApi();
  const { tweaks } = useAppearance();
  const [stats, setStats] = useState<SysStats | null>(null);
  const [usage, setUsage] = useState<FsUsage | null>(null);
  const [tab, setTab] = useState<AboutTab>("overview");

  // Stats are MOCK when the active target is mock/demo — flag it so About never
  // presents invented machine specs as the real host (VPS-essence honesty).
  const isSample =
    IS_DEMO || effectiveServerTarget(tweaks.server, IS_DEMO)?.kind === "mock";

  useEffect(() => {
    let alive = true;
    Promise.all([api.sys.stats(), api.fs.usage()])
      .then(([s, u]) => {
        if (!alive) return;
        setStats(s);
        setUsage(u);
      })
      .catch(() => {
        /* keep loading placeholders instead of flashing invented values */
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const rows: [string, ReactNode][] = [
    ["Status", "Public Alpha"],
    ["App version", pkg.version ?? "0.0.0"],
    ["Build ID", process.env.NEXT_PUBLIC_BUILD_ID || "dev"],
    ["Commit", process.env.NEXT_PUBLIC_COMMIT_SHA || "not set"],
    ["Runtime mode", IS_DEMO ? "Demo — mock data only" : "Live-capable"],
    ["Cores", stats ? String(stats.cpu.cores) : <ValueSkeleton width="w-8" />],
    ["Memory", stats ? fmtGiB(stats.mem.total) : <ValueSkeleton />],
    ["Disk", stats ? fmtGiB(stats.disk.total) : <ValueSkeleton />],
    [
      "Uptime",
      stats ? fmtUptime(stats.uptime) : <ValueSkeleton width="w-24" />,
    ],
    [
      "Storage used",
      usage ? (
        `${fmtGiB(usage.used)} of ${fmtGiB(usage.total)}`
      ) : (
        <ValueSkeleton width="w-28" />
      ),
    ],
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 p-3 sm:p-4">
        <MsoMark className="size-12 shrink-0 shell-icon-tile sm:size-14" />
        <div className="min-w-0">
          <div className="truncate text-base font-bold tracking-tight text-foreground sm:text-lg">
            {APP_NAME}
          </div>
          <div className="text-xs text-muted-foreground">{APP_TAGLINE}</div>
          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/80">
            v{pkg.version ?? "0.0.0"} ·{" "}
            {process.env.NEXT_PUBLIC_COMMIT_SHA || "development"}
          </div>
        </div>
      </div>

      <Tabs className="gap-4">
        <div className="overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="min-w-max">
            {ABOUT_TABS.map((item) => (
              <TabsTrigger
                key={item.id}
                active={tab === item.id}
                onClick={() => setTab(item.id)}
                className="min-h-9 [@media(pointer:coarse)]:min-h-[44px]"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div
          role="tabpanel"
          aria-label={ABOUT_TABS.find((item) => item.id === tab)?.label}
        >
          {tab === "overview" && (
            <SettingsSection
              icon={<Info />}
              title="System"
              footnote={
                isSample
                  ? "Sample data — connect a live host in Server for real specs."
                  : "Build identity and live host capacity."
              }
            >
              {rows.map(([key, value]) => (
                <SettingsValueRow key={key} label={key} value={value} />
              ))}
            </SettingsSection>
          )}

          {tab === "update" && <UpdateSection />}

          {tab === "whats-new" && <WhatsNew />}

          {tab === "maintenance" && (
            <div className="space-y-4 sm:space-y-5">
              <SettingsSection
                icon={<Info />}
                title="Setup"
                footnote="Reopen the guided setup without resetting existing configuration."
              >
                <SettingsActionRow
                  label="Open onboarding"
                  icon={<Info />}
                  onClick={openOnboarding}
                />
              </SettingsSection>
              <MaintenanceSection />
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
