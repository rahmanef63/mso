"use client";

import { useState } from "react";
import { Activity, AlertCircle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePublishInspector, useOsApi, useResponsive, ResponsiveToolbar, type ToolbarItem } from "./lib/host";
import { AppFrame } from "./components/host-frame";
import { GaugeGrid } from "./components/gauge-grid";
import { GlassPanel } from "./components/glass-panel";
import { Sparkline } from "./components/sparkline";
import { ProcessTable } from "./components/process-table";
import { ServicesPanel } from "./components/services-panel";
import { PackageUpdatesPanel } from "./components/package-updates-panel";
import { useStatsHistory } from "./lib/use-stats-history";
import { MONITOR_VARS, type MonitorVar } from "./lib/palette";
import { fmtGiBPair, fmtMBs, fmtPct } from "./lib/format";

type MonitorTab = "overview" | "services" | "updates";

export default function SystemMonitor() {
  const api = useOsApi();
  const { isMobile } = useResponsive();
  const [tab, setTab] = useState<MonitorTab>("overview");
  const { stats, procs, cpuSeries, netSeries, gpu, error, refresh } = useStatsHistory(tab === "overview");

  usePublishInspector("system-monitor", {
    subject: tab === "overview" ? "VPS host" : tab === "services" ? "systemd services" : "package updates",
    props: [
      { label: "View", value: tab },
      { label: "Role", value: api.access.role },
      { label: "CPU", value: stats ? fmtPct(stats.cpu.pct) : "—" },
      { label: "Memory", value: stats ? fmtGiBPair(stats.mem.used, stats.mem.total) : "—" },
      { label: "Processes", value: String(procs.length) },
      { label: "Mode", value: api.mode },
    ],
    actions: tab === "overview" ? [{ id: "refresh", label: "Refresh", run: refresh }] : [],
    context: `System Monitor ${tab}; role=${api.access.role}; mode=${api.mode}`,
    suggestions: tab === "overview" ? ["Why is CPU high?", "What's using memory?"] : tab === "services" ? ["Which service is failing?"] : ["Summarize cached updates"],
  }, [tab, stats, procs.length, api.mode, api.access.role, refresh]);

  const toolbarItems: ToolbarItem[] = tab === "overview"
    ? [{ id: "refresh", label: "Refresh", icon: RotateCw, onClick: refresh, primary: true }]
    : [];
  const chipLabel = isMobile ? api.access.role : `${api.mode} · ${api.access.role}`;

  return (
    <AppFrame header={
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {!isMobile && <Activity className="size-4 shrink-0 text-primary" />}
          {!isMobile && <h2 className="truncate text-sm font-semibold">System Monitor</h2>}
          <span className="shrink-0 rounded-full bg-[color:var(--inset)] px-2 py-0.5 font-mono text-[10px] text-[color:var(--text-dim)]">{chipLabel}</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <Tabs className="min-w-0">
            <TabsList className="max-w-full overflow-x-auto">
              {(["overview", "services", "updates"] as const).map((value) => (
                <TabsTrigger key={value} active={tab === value} onClick={() => setTab(value)} className="capitalize">{value}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {toolbarItems.length > 0 && <ResponsiveToolbar items={toolbarItems} />}
        </div>
      </header>
    }>
      {tab === "overview" ? <Overview stats={stats} procs={procs} cpuSeries={cpuSeries} netSeries={netSeries} gpu={gpu} error={error} refresh={refresh} /> : null}
      {tab === "services" ? <ServicesPanel /> : null}
      {tab === "updates" ? <PackageUpdatesPanel /> : null}
    </AppFrame>
  );
}

function Overview({ stats, procs, cpuSeries, netSeries, gpu, error, refresh }: ReturnType<typeof useStatsHistory>) {
  if (!stats && error) return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"><AlertCircle className="size-6 text-destructive" /><p className="max-w-xs text-xs text-muted-foreground">{error}</p><Button variant="outline" size="sm" onClick={refresh}><RotateCw className="size-3.5" /> Retry</Button></div>;
  if (!stats) return <div className="flex h-full items-center justify-center gap-2 text-xs text-[color:var(--text-faint)]"><Loader2 className="size-4 animate-spin" /> Reading host telemetry…</div>;
  const lastNet = netSeries[netSeries.length - 1] ?? 0;
  return (
    <div className="space-y-3.5 p-4" style={MONITOR_VARS as React.CSSProperties}>
      <GaugeGrid stats={stats} gpu={gpu} />
      <div className="grid grid-cols-2 gap-3 @max-[440px]:grid-cols-1">
        <GlassPanel title="CPU load" right={fmtPct(stats.cpu.pct)}><Sparkline data={cpuSeries} accent={"--mon-cpu" as MonitorVar} max={100} /></GlassPanel>
        <GlassPanel title="Network" right={fmtMBs(lastNet)}><Sparkline data={netSeries} accent={"--mon-net" as MonitorVar} /></GlassPanel>
      </div>
      <GlassPanel title="Processes"><ProcessTable processes={procs} /></GlassPanel>
    </div>
  );
}
