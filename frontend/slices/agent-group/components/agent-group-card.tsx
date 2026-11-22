"use client";

import { useEffect, useState } from "react";
import { Pencil, Play, Square, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { agentGroupAction, loadAgentGroup, runAgentGroup, stopAgentGroup } from "../lib/api";
import type { AgentGroupRun, AgentGroupView } from "../types";

const stateTone = (state: AgentGroupRun["state"]) =>
  state === "completed" ? "text-muted-foreground" : state === "running" ? "text-primary" : "text-destructive";

export function AgentGroupCard({
  row,
  revision,
  onEdit,
  onReload,
}: {
  row: AgentGroupView;
  revision: number;
  onEdit: () => void;
  onReload: () => Promise<void>;
}) {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [live, setLive] = useState<AgentGroupRun | null>(null);
  const run0 = row.runs[0] ?? null;
  const latest = live && (!run0 || live.updatedAt >= run0.updatedAt) ? live : run0;

  useEffect(() => {
    if (latest?.state !== "running") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await loadAgentGroup(row.id);
        if (!cancelled) setLive(next.runs[0] ?? null);
      } catch { /* keep polling */ }
    }, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [latest?.state, latest?.id, row.id]);

  const run = async (name: string, body: Record<string, unknown>, reload = true) => {
    setBusy(name); setMessage("");
    try {
      await agentGroupAction(body);
      if (reload) await onReload();
      if (name === "stop") setMessage("Discussion stopped.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Action failed.");
    } finally { setBusy(""); }
  };

  const start = async () => {
    setBusy("run"); setMessage("");
    try {
      const started = await runAgentGroup(row.id, topic);
      setLive(started);
      setTopic("");
      await onReload();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not start the discussion.");
    } finally { setBusy(""); }
  };

  const stop = async () => {
    if (!latest) return;
    setBusy("stop");
    try { setLive(await stopAgentGroup(latest.id)); await onReload(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not stop."); }
    finally { setBusy(""); }
  };

  return <article className="flex min-w-0 flex-col rounded-xl border bg-card" data-slot="agent-group-card">
    <header className="flex items-start gap-3 border-b p-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/40"><Users className="size-4"/></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{row.name}</h3>
          <Badge variant="outline">{row.members.length} agents</Badge>
          <Badge variant="outline">{row.maxRounds} round{row.maxRounds > 1 ? "s" : ""}</Badge>
          {!row.enabled ? <Badge variant="outline" className="text-destructive">Disabled</Badge> : null}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {row.members.map((member) => <span key={member.id} className="rounded-md border bg-muted/30 px-1.5 py-0.5 text-[10px]">
            {member.name} · {member.profile}{member.telegram ? " · TG" : ""}
          </span>)}
        </div>
      </div>
      <Button size="icon" variant="ghost" aria-label="Edit group" onClick={onEdit}><Pencil className="size-3"/></Button>
      <Button size="icon" variant="ghost" aria-label="Delete group" disabled={Boolean(busy)} onClick={() => {
        if (window.confirm(`Delete ${row.name}?`)) void run("delete", { action: "delete", id: row.id, expectedRevision: revision });
      }}><Trash2 className="size-3"/></Button>
    </header>

    <div className="space-y-3 p-4">
      <Textarea value={topic} rows={2} maxLength={4000} placeholder="Discussion topic (e.g. Should we ship the new onboarding?)" onChange={(event) => setTopic(event.target.value)}/>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={Boolean(busy) || !topic.trim() || !row.enabled} onClick={() => void start()}>
          <Play className="mr-2 size-3"/>{busy === "run" ? "Starting…" : "Start discussion"}
        </Button>
        {latest?.state === "running" ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void stop()}>
          <Square className="mr-2 size-3"/>Stop
        </Button> : null}
        {latest ? <span className={`text-xs ${stateTone(latest.state)}`}>{latest.state} · {latest.turns.length} turn{latest.turns.length === 1 ? "" : "s"}</span> : null}
      </div>

      {latest ? <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Topic: {latest.prompt}</div>
        {latest.turns.length ? latest.turns.map((turn, index) => <div key={`${turn.memberId}:${turn.round}:${index}`} className="text-xs" data-slot="agent-group-turn">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{turn.name}</span>
            <span className="text-[10px] text-muted-foreground">round {turn.round}</span>
          </div>
          <p className={turn.error ? "text-destructive" : "text-muted-foreground"}>
            {turn.error ? `No reply: ${turn.error}` : turn.text}
          </p>
        </div>) : <p className="text-xs text-muted-foreground">Waiting for the first reply…</p>}
      </div> : null}

      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  </article>;
}
