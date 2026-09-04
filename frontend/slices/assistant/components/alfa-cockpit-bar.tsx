"use client";

import { useState } from "react";
import { Activity, FolderGit2, Gauge, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAlfaApprovalCount, useAlfaBusy } from "@/features/appshell";
import { useAlfaCockpit } from "./use-alfa-cockpit";
import { AlfaCockpitDialog } from "./alfa-cockpit-dialog";

export function AlfaCockpitBar({ onActivity }: { onActivity: () => void }) {
  const [open, setOpen] = useState(false);
  const { data, loading, error, selectedProjectId, selectProject, refresh } = useAlfaCockpit();
  const approvals = useAlfaApprovalCount();
  const busy = useAlfaBusy();
  const project = data?.selectedProject?.project.name ?? data?.projects.rows.find((row) => row.id === selectedProjectId)?.name;

  return (
    <>
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border/70 bg-background/80 px-3 py-1.5 [scrollbar-width:none]">
        <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1.5 px-2 text-[11px]" onClick={() => setOpen(true)}>
          <FolderGit2 className="size-3.5" />{project || "Choose project"}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1.5 px-2 text-[11px]" onClick={() => setOpen(true)}>
          <Gauge className="size-3.5" />{data ? `${data.model.provider}/${data.model.model}` : loading ? "Loading…" : "Runtime"}
        </Button>
        <div className="flex-1" />
        {approvals ? <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-[10px]" onClick={() => setOpen(true)}><ShieldCheck className="size-3.5" />{approvals} approval{approvals === 1 ? "" : "s"}</Button> : null}
        <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1.5 px-2 text-[11px]" onClick={onActivity}>
          <Activity className={busy ? "size-3.5 animate-pulse" : "size-3.5"} />{busy ? "Running" : "Activity"}
        </Button>
        <Button size="sm" variant={error ? "outline" : "ghost"} className="h-8 shrink-0 px-2 text-[11px]" onClick={() => setOpen(true)}>{error ? "Needs attention" : "Cockpit"}</Button>
      </div>
      <AlfaCockpitDialog
        open={open}
        onOpenChange={setOpen}
        data={data}
        loading={loading}
        error={error}
        selectedProjectId={selectedProjectId}
        onSelectProject={selectProject}
        onRefresh={refresh}
        onActivity={onActivity}
      />
    </>
  );
}
