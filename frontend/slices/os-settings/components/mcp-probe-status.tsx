"use client";

import { CheckCircle2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MCP_PROBE_LABELS, type McpProbeResult } from "./mcp-client-core";

export type ProbeState = "checking" | "ready" | "error";

export function McpProbeStatus({ state, result, endpoint }: { state: ProbeState; result: McpProbeResult | null; endpoint: string }) {
  const ready = state === "ready";
  return (
    <div className={cn(
      "space-y-2 rounded-lg border px-3 py-2.5",
      ready ? "border-success/30 bg-success/10" : state === "error" ? "border-destructive/30 bg-destructive/10" : "border-border bg-secondary/35",
    )}>
      <div className="flex items-start gap-2">
        {ready ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <p className="text-xs font-medium">{ready ? "MCP + OAuth discovery ready" : state === "error" ? "One or more connection checks failed" : "Checking MCP + OAuth discovery…"}</p>
          <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{endpoint}</p>
        </div>
      </div>
      {result && (
        <div className="flex flex-wrap gap-1.5 pl-6">
          {result.checks.map((check) => (
            <span key={check.id} className={cn("rounded-md px-2 py-1 text-[10px] font-medium", check.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>{MCP_PROBE_LABELS[check.id]}</span>
          ))}
        </div>
      )}
    </div>
  );
}
