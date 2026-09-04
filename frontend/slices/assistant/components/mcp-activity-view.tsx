"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, BadgeCheck, BookOpen, Boxes, Camera, CheckCircle2, ChevronDown, CircleDashed,
  FolderTree, Gauge, GitBranch, Globe2, Hammer, Route, Search, ShieldAlert, SquareTerminal,
  Wrench, XCircle, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { groupActivity, type McpActivityGroup, type McpActivityRow } from "./mcp-activity-model";
import { useAlfaActivity } from "../lib/alfa-activity";

const stateMeta = {
  started: { label: "running", Icon: CircleDashed, cls: "text-info" },
  completed: { label: "done", Icon: CheckCircle2, cls: "text-success" },
  failed: { label: "failed", Icon: XCircle, cls: "text-destructive" },
  denied: { label: "denied", Icon: ShieldAlert, cls: "text-warning" },
  rate_limited: { label: "limited", Icon: ShieldAlert, cls: "text-warning" },
  cancelled: { label: "cancelled", Icon: XCircle, cls: "text-muted-foreground" },
} as const;

const groupMeta = {
  running: { label: "Running", Icon: CircleDashed, cls: "text-info" },
  attention: { label: "Needs attention", Icon: ShieldAlert, cls: "text-warning" },
  cancelled: { label: "Cancelled", Icon: XCircle, cls: "text-muted-foreground" },
  done: { label: "Verified", Icon: BadgeCheck, cls: "text-success" },
  completed: { label: "Completed", Icon: CheckCircle2, cls: "text-success" },
  active: { label: "In progress", Icon: Route, cls: "text-muted-foreground" },
} as const;

function toolMeta(row: McpActivityRow): { Icon: LucideIcon; label: string } {
  const target = (row.target ?? "").toLowerCase();
  if (row.tool === "alfa.chat") return { Icon: Activity, label: "Alfa" };
  if (row.tool.startsWith("skills_") || row.tool.startsWith("skills.")) return { Icon: BookOpen, label: "Skills" };
  if (row.tool.startsWith("workflow_")) return { Icon: Route, label: "Workflow" };
  if (row.tool === "screen_capture") return { Icon: Camera, label: "Screenshot" };
  if (row.tool === "fs_search") return { Icon: Search, label: "Search" };
  if (row.tool.startsWith("fs_")) return { Icon: FolderTree, label: "Files" };
  if (row.tool.startsWith("sys_")) return { Icon: Gauge, label: "System" };
  if (row.tool.startsWith("apps_")) return { Icon: Boxes, label: "Apps" };
  if (row.tool.startsWith("browser_")) return { Icon: Globe2, label: "Browser" };
  if (row.tool === "exec_run" && /(build|test|verify|lint|typecheck|coverage)/.test(target))
    return { Icon: target.includes("verify") ? BadgeCheck : Hammer, label: target.includes("verify") ? "Verify" : "Build/Test" };
  if (row.tool === "exec_run" && /(^|\s)git(\s|$)/.test(target)) return { Icon: GitBranch, label: "Git" };
  if (row.tool === "exec_run") return { Icon: SquareTerminal, label: "Terminal" };
  return { Icon: Wrench, label: "Tool" };
}

const fmtDuration = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s` : `${ms}ms`;

function WorkflowDetails({ group, initiallyOpen }: { group: McpActivityGroup; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const renderedOpen = group.state === "running" || open;
  const status = groupMeta[group.state];
  const StatusIcon = status.Icon;

  return (
    <details
      className="group rounded-xl border border-border/70 bg-card/50"
      open={renderedOpen}
      onToggle={(event) => { if (group.state !== "running") setOpen(event.currentTarget.open); }}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5">
        <StatusIcon className={`mt-0.5 size-4 shrink-0 ${status.cls} ${group.state === "running" ? "animate-spin" : ""}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{group.intent ?? (group.workflowId ? "MSO workflow" : group.rows[0]?.tool)}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {group.project ?? "No project"} · {group.rows.length} step{group.rows.length === 1 ? "" : "s"}
            {group.durationMs ? ` · ${fmtDuration(group.durationMs)}` : ""} · {new Date(group.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>
        <span className={`shrink-0 text-[10px] ${status.cls}`}>{status.label}</span>
        <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ul className="space-y-1 border-t border-border/70 p-2">
        {group.rows.map((row) => {
          const state = stateMeta[row.state];
          const StateIcon = state.Icon;
          const feature = toolMeta(row);
          const FeatureIcon = feature.Icon;
          return (
            <li key={row.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/40">
              <FeatureIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[10px] text-muted-foreground">[{feature.label}]</span>
                  <code className="truncate font-mono text-[11px] font-medium">{row.tool}</code>
                </div>
                {row.target || row.detail ? <p className="truncate font-mono text-[10px] text-muted-foreground">{row.target ?? row.detail}</p> : null}
              </div>
              <StateIcon className={`mt-0.5 size-3 shrink-0 ${state.cls} ${row.state === "started" ? "animate-spin" : ""}`} />
              {row.durationMs != null ? <span className="shrink-0 text-[9px] text-muted-foreground">{fmtDuration(row.durationMs)}</span> : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function McpActivityView() {
  const [entries, setEntries] = useState<McpActivityRow[]>([]);
  const alfaEntries = useAlfaActivity();
  const [paused, setPaused] = useState(false);
  const load = useCallback(() => {
    fetch("/api/mcp/activity?limit=200", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((data: { entries?: McpActivityRow[] }) => setEntries(data.entries ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    if (paused) return;
    const timer = window.setInterval(load, 1000);
    return () => window.clearInterval(timer);
  }, [load, paused]);

  const groups = useMemo(() => groupActivity([...alfaEntries, ...entries].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())), [alfaEntries, entries]);
  const running = groups.filter((group) => group.state === "running").length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Activity className="size-4" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Activity & Runs</p>
          <p className="text-[10px] text-muted-foreground">
            {running ? `${running} run${running === 1 ? "" : "s"} active now` : "Alfa tool calls plus MSO workflows, grouped by task"}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">
          <span className={`size-1.5 rounded-full ${paused ? "bg-muted-foreground" : "bg-success animate-pulse"}`} />
          {paused ? "Paused" : "Live"}
        </span>
        <Button variant="ghost" size="sm" className="h-8 text-[11px]" onClick={() => setPaused((value) => !value)}>
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {groups.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
            <div><Camera className="mx-auto mb-2 size-7 opacity-60" />No activity yet.</div>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group, index) => <WorkflowDetails key={group.key} group={group} initiallyOpen={group.state === "running" || index < 2} />)}
          </div>
        )}
      </div>
    </div>
  );
}
