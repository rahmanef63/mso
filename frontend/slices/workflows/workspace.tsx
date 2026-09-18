"use client";

import { useEffect, useId, useState } from "react";
import type { AppProps } from "@/features/appshell";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import NativeWorkflowsApp from "./app";
import { WorkflowEmbedPanel } from "./components/workflow-embed-panel";

export default function WorkflowsWorkspace(props: AppProps) {
  const [apps, setApps] = useState<WorkflowEmbed[]>([]);
  const [selected, setSelected] = useState("__native");
  const [visited, setVisited] = useState<string[]>([]);
  const prefix = useId();
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/v1/workflow-embeds", { cache: "no-store", signal: controller.signal });
        if (!response.ok) { if ([401, 403].includes(response.status)) setApps([]); return; }
        const data = await response.json() as { apps: WorkflowEmbed[] };
        setApps(data.apps);
      } catch { /* Keep mounted editors on transient network failures; authorization failures clear them above. */ }
    };
    void load(); window.addEventListener("focus", load);
    return () => { controller.abort(); window.removeEventListener("focus", load); };
  }, []);
  useEffect(() => {
    if (!props.payload || typeof props.payload !== "object" || !("view" in props.payload) || props.payload.view !== "sessions") return;
    const frame = requestAnimationFrame(() => setSelected("__native"));
    return () => cancelAnimationFrame(frame);
  }, [props.payload]);
  const active = apps.some((app) => app.id === selected) ? selected : "__native";
  const choices = [{ id: "__native", title: "MSO" }, ...apps];
  const select = (id: string) => { setSelected(id); setVisited((ids) => ids.includes(id) ? ids : [...ids, id]); };
  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-slot="workflows-workspace">
    {apps.length ? <div role="tablist" aria-label="Workflow providers" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1">
      {choices.map((choice, index) => <Button key={choice.id} id={`${prefix}-tab-${choice.id}`} role="tab" aria-selected={active === choice.id} aria-controls={`${prefix}-panel-${choice.id}`} tabIndex={active === choice.id ? 0 : -1} variant={active === choice.id ? "secondary" : "ghost"} size="sm" className="shrink-0" onClick={() => select(choice.id)} onKeyDown={(event) => {
        const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : offset ? (index + offset + choices.length) % choices.length : -1;
        if (next < 0) return;
        event.preventDefault(); select(choices[next].id); document.getElementById(`${prefix}-tab-${choices[next].id}`)?.focus();
      }}>{choice.title}</Button>)}
    </div> : null}
    <section id={`${prefix}-panel-__native`} role={apps.length ? "tabpanel" : undefined} aria-labelledby={apps.length ? `${prefix}-tab-__native` : undefined} hidden={active !== "__native"} className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", active !== "__native" && "hidden")}>
      <NativeWorkflowsApp {...props}/>
    </section>
    {apps.map((app) => <section key={app.id + app.origin + String(app.blocked)} id={`${prefix}-panel-${app.id}`} role="tabpanel" aria-labelledby={`${prefix}-tab-${app.id}`} hidden={active !== app.id} className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", active !== app.id && "hidden")}>{visited.includes(app.id) ? <WorkflowEmbedPanel app={app}/> : null}</section>)}
  </div>;
}
