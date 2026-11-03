"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, RefreshCw } from "lucide-react";
import type { AppProps } from "@/features/appshell";
import { AppFrame, openWindow } from "@/features/appshell";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { N8nEmbedPanel } from "./components/n8n-embed-panel";

type EmbedResponse = { apps?: WorkflowEmbed[] };

export default function N8nApp(_: AppProps) {
  const [apps, setApps] = useState<WorkflowEmbed[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch("/api/v1/workflow-embeds", { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setApps([]);
        setMessage(response.status === 403 ? "Owner access is required to view the reviewed n8n surface." : "Could not load the n8n surface.");
        return;
      }
      const data = await response.json() as EmbedResponse;
      if (controller.signal.aborted) return;
      setApps(Array.isArray(data.apps) ? data.apps : []);
      setMessage("");
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : "Could not load the n8n surface.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void load(); });
    window.addEventListener("focus", load);
    return () => {
      request.current?.abort();
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const n8n = useMemo(() => apps.find((app) => app.id === "n8n" || app.title.trim().toLowerCase() === "n8n") ?? null, [apps]);

  const toolbar = <div className="flex h-11 min-w-0 items-center gap-2 px-3">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">n8n</span>
        <Badge variant={n8n ? "secondary" : "outline"} className={n8n?.blocked ? "text-[9px] text-destructive" : "text-[9px]"}>
          {n8n?.blocked ? "Blocked" : n8n ? "Reviewed" : loading ? "Loading" : "Not configured"}
        </Badge>
      </div>
    </div>
    <Button size="icon" variant="ghost" onClick={() => { setLoading(true); void load(); }} aria-label="Refresh n8n surface"><RefreshCw className="size-4"/></Button>
  </div>;

  return <div data-slot="n8n-feature" className="@container h-full min-h-0 min-w-0">
    <AppFrame safeArea={false} className="h-full min-w-0" toolbar={toolbar}>
      {loading && !n8n ? <div role="status" className="grid h-full place-items-center p-[var(--feature-padding,1.5rem)] text-sm text-muted-foreground">Loading n8n workspace…</div> : n8n ? <div className="flex h-full min-h-0 flex-col">
        {message && <p role="alert" className="shrink-0 border-b p-3 text-sm text-destructive-text">Refresh failed. Showing the last loaded surface. {message}</p>}
        {loading && <p role="status" className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">Refreshing n8n surface…</p>}
        <div className="min-h-0 flex-1"><N8nEmbedPanel app={n8n}/></div>
      </div> : <div className="grid h-full min-h-0 place-items-center overflow-y-auto p-6">
        <div className="w-full max-w-2xl rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border bg-muted/40"><Boxes className="size-5 text-muted-foreground"/></div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">n8n is now a separate workspace</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">Connect a reviewed n8n surface here. Native MSO Workflows continues to own automation graphs and executions; Organization owns units, seats, projects, members, and execution routing context.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 @min-[620px]:grid-cols-3">
            <QuickLink title="Native Workflows" detail="Build, run, inspect, version, and manage automation." onClick={() => openWindow("workflows", "Workflows")}/>
            <QuickLink title="Organization" detail="Manage units, seats, projects, members, and routing context." onClick={() => openWindow("organization", "Organization")}/>
            <QuickLink title="Integrations" detail="Keep provider connections and credentials outside workflow definitions." onClick={() => openWindow("integrations", "Integrations")}/>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{message || "No reviewed n8n surface is configured for this owner yet."}</p>
        </div>
      </div>}
    </AppFrame>
  </div>;
}

function QuickLink({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="rounded-xl border bg-background p-3 text-left transition hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="text-xs font-semibold">{title}</div>
    <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</div>
  </button>;
}
