"use client";

import { Activity, Brain, Bot, Cpu, FolderGit2, RefreshCw, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog, openWindow, sendToAlfa } from "@/features/appshell";
import type { AlfaCockpitData, HostSkillRow } from "../lib/cockpit-types";
import { HostSkillsSection } from "./host-skills-section";
import { ModelQuickControl } from "./model-quick-control";
import { ProjectQuickSelect } from "./project-quick-select";

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Cpu; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-border/70 bg-card/35 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold"><Icon className="size-3.5 text-muted-foreground" />{title}</div>
      {children}
    </section>
  );
}

export function AlfaCockpitDialog({
  open, onOpenChange, data, loading, error, selectedProjectId, onSelectProject, onRefresh, onActivity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: AlfaCockpitData | null;
  loading: boolean;
  error: string | null;
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onRefresh: () => void;
  onActivity: () => void;
}) {
  const selected = data?.selectedProject;
  const projectMcp = selected?.integrations?.projectMcp?.length ?? 0;

  const useSkill = (skill: HostSkillRow) => {
    const project = selected?.project;
    const projectNote = project ? ` Apply it in the selected project ${project.name} (${project.path}).` : "";
    void sendToAlfa(`Use the host skill \"${skill.id}\" for this task. Read it first with skills.read and follow only trusted instructions.${projectNote}`);
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} variant="panel" size="lg" sheetSide="right">
      <ResponsiveDialog.Header>
        <ResponsiveDialog.Title>Alfa Cockpit</ResponsiveDialog.Title>
        <ResponsiveDialog.Description>Execution context and MSO runtime state. Read-only unless Alfa asks for an approved action.</ResponsiveDialog.Description>
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Body className="space-y-3">
        {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">{error}</p> : null}
        <Section title="Runtime" icon={Cpu}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{data ? data.model.provider : loading ? "Loading provider…" : "Provider unavailable"}</Badge>
            {data?.model.tokenSaver && data.model.tokenSaver !== "off" ? <Badge variant="outline">token saver · {data.model.tokenSaver}</Badge> : null}
            <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => openWindow("settings", "Settings", undefined, { tab: "ai" })}><Settings2 className="size-3.5" />AI settings</Button>
          </div>
          {data ? <ModelQuickControl provider={data.model.provider} model={data.model.model} onSaved={onRefresh} /> : null}
        </Section>

        <Section title="Project Context" icon={FolderGit2}>
<ProjectQuickSelect rows={data?.projects.rows ?? []} selected={selected ?? null} value={selectedProjectId} onChange={onSelectProject} />
          {data?.projects.hasMore || data?.projects.scan?.truncated ? (
            <p className="text-[10px] text-warning">Project list is bounded/incomplete; Alfa will not assume an absent project does not exist.</p>
          ) : null}
          {selected ? (
            <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
              <div><span className="text-muted-foreground">Branch</span><p className="truncate font-medium">{selected.git.branch || "—"}</p></div>
              <div><span className="text-muted-foreground">Tree</span><p className="font-medium">{selected.git.clean === true ? "clean" : selected.git.clean === false ? "changed" : "—"}</p></div>
              <div><span className="text-muted-foreground">HEAD</span><p className="truncate font-mono">{selected.git.head?.sha?.slice(0, 10) || "—"}</p></div>
              <div><span className="text-muted-foreground">Package</span><p className="truncate font-medium">{selected.package?.name || "—"}</p></div>
              <div><span className="text-muted-foreground">Knowledge</span><p className="font-medium">{selected.knowledge?.exists ? "available" : "none"}</p></div>
              <div><span className="text-muted-foreground">Integrations</span><p className="font-medium">{projectMcp} MCP · {selected.database?.detected ? "DB" : "no DB"}</p></div>
            </div>
          ) : <p className="text-[11px] text-muted-foreground">Choose a project to ground Alfa in its repo, branch, knowledge presence, and recent project-memory topics.</p>}
          {(selected?.recentMemory?.length ?? 0) > 0 ? (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Recent project memory</p>
              {selected!.recentMemory!.slice(0, 4).map((row) => <p key={row.id} className="truncate text-[11px]">{row.kind} · {row.title}</p>)}
            </div>
          ) : null}
        </Section>

        <HostSkillsSection open={open} onUse={useSkill} />

        <Section title="Persistent Memory" icon={Brain}>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <Badge variant="outline">{data?.typedMemory.telemetry.resolvedKeys ?? 0} resolved keys</Badge>
            <Badge variant="outline">{data?.typedMemory.telemetry.archivedRecords ?? 0} archived</Badge>
            {(data?.typedMemory.telemetry.conflictKeys ?? 0) > 0 ? <Badge variant="outline">{data!.typedMemory.telemetry.conflictKeys} conflicts</Badge> : null}
          </div>
          {(data?.typedMemory.records ?? []).slice(0, 5).map((row) => (
            <div key={row.id} className="flex items-start gap-2 text-[11px]"><span className="min-w-0 flex-1"><b>{row.key}</b> · {row.value}</span><Badge variant="secondary" className="text-[9px]">{row.kind}</Badge></div>
          ))}
          {(data?.legacyMemoryCount ?? 0) > 0 ? <p className="text-[10px] text-muted-foreground">Plus {data!.legacyMemoryCount} Alfa owner fact{data!.legacyMemoryCount === 1 ? "" : "s"} in the legacy chat-memory store; raw text is not copied into Cockpit.</p> : null}
        </Section>

        <Section title="Native Sessions & Agents" icon={Bot}>
          {(data?.sessions ?? []).slice(0, 4).map((session) => <div key={session.id} className="flex gap-2 text-[11px]"><span className="min-w-0 flex-1 truncate">@{session.name} · {session.title}</span><Badge variant="outline" className="text-[9px]">{session.source}</Badge></div>)}
          {(data?.localAgents ?? []).length ? <div className="flex flex-wrap gap-1.5 pt-1">{data!.localAgents.slice(0, 8).map((agent) => <Badge key={agent.id} variant="secondary">{agent.label} · {agent.status}</Badge>)}</div> : <p className="text-[10px] text-muted-foreground">No active same-owner local agents.</p>}
          <p className="text-[10px] text-muted-foreground">These are durable MSO Agent sessions, separate from Alfa&apos;s browser chat history.</p>
        </Section>
      </ResponsiveDialog.Body>
      <ResponsiveDialog.Footer>
        <Button variant="outline" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button>
        <Button variant="outline" onClick={() => { onActivity(); onOpenChange(false); }}><Activity className="size-3.5" />Activity</Button>
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
