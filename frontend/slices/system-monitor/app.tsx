"use client";

import { Activity, AlertCircle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  usePublishInspector,
  useOsApi,
  useResponsive,
  ResponsiveToolbar,
  type ToolbarItem,
} from "./lib/host";
import { AppFrame } from "./components/host-frame";
import { GaugeGrid } from "./components/gauge-grid";
import { GlassPanel } from "./components/glass-panel";
import { Sparkline } from "./components/sparkline";
import { ProcessTable } from "./components/process-table";
import { useStatsHistory } from "./lib/use-stats-history";
import { MONITOR_VARS, type MonitorVar } from "./lib/palette";
import { fmtGiBPair, fmtMBs, fmtPct } from "./lib/format";

// Default export so os-shell can lazy-load it as a window app.
export default function SystemMonitor() {
  const api = useOsApi();
  const { isMobile } = useResponsive();
  // Mobile shell navigation owns the feature title on both iOS and Android.
  const { stats, procs, cpuSeries, netSeries, gpu, error, refresh } = useStatsHistory();

  usePublishInspector(
    "system-monitor",
    {
      subject: "VPS host",
      props: [
        { label: "CPU", value: stats ? fmtPct(stats.cpu.pct) : "—" },
        { label: "Memory", value: stats ? fmtGiBPair(stats.mem.used, stats.mem.total) : "—" },
        { label: "Disk", value: stats ? fmtGiBPair(stats.disk.used, stats.disk.total) : "—" },
        { label: "Processes", value: String(procs.length) },
        { label: "Mode", value: api.mode },
      ],
      actions: [{ id: "refresh", label: "Refresh", run: refresh }],
      context: stats
        ? `System monitor: cpu ${fmtPct(stats.cpu.pct)}, mem ${fmtGiBPair(stats.mem.used, stats.mem.total)} (${api.mode})`
        : "System monitor: reading host telemetry…",
      suggestions: ["Why is CPU high?", "What's using memory?", "Recommend cleanup"],
    },
    [stats, procs.length, api.mode, refresh],
  );

  // Error path: telemetry never landed AND the poll keeps failing — surface a
  // retry tile so the user can act instead of staring at a frozen spinner.
  if (!stats && error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="size-6 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Couldn&apos;t load stats</p>
          <p className="max-w-xs text-xs text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
          <RotateCw className="size-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-[color:var(--text-faint)]">
        <Loader2 className="size-4 animate-spin" /> Reading host telemetry…
      </div>
    );
  }

  const lastNet = netSeries[netSeries.length - 1] ?? 0;
  // Toolbar actions live as data; ResponsiveToolbar collapses non-primary items
  // into a ⋯ menu on compact form factors. Refresh stays primary (always inline).
  const toolbarItems: ToolbarItem[] = [
    { id: "refresh", label: "Refresh", icon: RotateCw, onClick: refresh, primary: true },
  ];
  const chipLabel = isMobile
    ? `${stats.cpu.cores}c`
    : `${stats.cpu.cores} cores · ${api.mode}`;

  return (
    <AppFrame
      header={
        <header className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {!isMobile && <Activity className="size-4 shrink-0 text-primary" />}
            {!isMobile && <h2 className="truncate text-sm font-semibold">System Monitor</h2>}
            <span className="shrink-0 rounded-full bg-[color:var(--inset)] px-2 py-0.5 font-mono text-[10px] text-[color:var(--text-dim)]">
              {chipLabel}
            </span>
          </div>
          <ResponsiveToolbar items={toolbarItems} />
        </header>
      }
    >
      <div
        className="space-y-3.5 p-4"
        style={MONITOR_VARS as React.CSSProperties}
      >
        <GaugeGrid stats={stats} gpu={gpu} />

        <div className="grid grid-cols-2 gap-3 @max-[440px]:grid-cols-1">
          <GlassPanel title="CPU load" right={fmtPct(stats.cpu.pct)}>
            <Sparkline data={cpuSeries} accent={"--mon-cpu" as MonitorVar} max={100} />
          </GlassPanel>
          <GlassPanel title="Network" right={fmtMBs(lastNet)}>
            <Sparkline data={netSeries} accent={"--mon-net" as MonitorVar} />
          </GlassPanel>
        </div>

        <GlassPanel title="Processes">
          <ProcessTable processes={procs} />
        </GlassPanel>
      </div>
    </AppFrame>
  );
}
