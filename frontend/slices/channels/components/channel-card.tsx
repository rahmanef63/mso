"use client";

import { useState } from "react";
import { Copy, Pencil, Send, TestTube2, Trash2, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { channelAction } from "../lib/api";
import type { ChannelView } from "../types";

function status(row: ChannelView) {
  if (!row.enabled) return { label: "Disabled", variant: "outline" as const };
  if (row.lastCheck && !row.lastCheck.ok) return { label: "Error", variant: "outline" as const, className: "text-destructive" };
  if (!row.connection || row.connection.state === "missing" || row.connection.state === "incomplete") {
    return { label: "Needs setup", variant: "outline" as const };
  }
  if (row.lastCheck?.ok || row.connection.state === "verified") return { label: "Connected", variant: "secondary" as const };
  return { label: "Configured", variant: "outline" as const };
}

export function ChannelCard({
  row,
  revision,
  workflowName,
  onEdit,
  onReload,
}: {
  row: ChannelView;
  revision: number;
  workflowName?: string;
  onEdit: () => void;
  onReload: () => Promise<void>;
}) {
  const [target, setTarget] = useState(row.defaultTarget ?? "");
  const [text, setText] = useState("Hello from MSO");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const state = status(row);
  const inboundPath = `/api/v1/channels/${row.provider}/${row.id}`;

  const run = async (name: string, body: Record<string, unknown>, reload = true) => {
    setBusy(name); setMessage("");
    try {
      await channelAction(body);
      setMessage(name === "send" ? "Message sent." : name === "test" ? "Connection verified." : "");
      if (reload) await onReload();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Action failed.");
    } finally { setBusy(""); }
  };

  return <article className="flex min-w-0 flex-col rounded-xl border bg-card">
    <header className="flex items-start gap-3 border-b p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{row.name}</h3>
          <Badge variant="outline" className="capitalize">{row.provider}</Badge>
          <Badge variant={state.variant} className={state.className}>{state.label}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {row.connection?.label ?? `${row.credential.user} / ${row.credential.connection}`}
        </p>
      </div>
      <Switch
        checked={row.enabled}
        disabled={Boolean(busy)}
        aria-label={`${row.name} enabled`}
        onCheckedChange={(enabled) => void run("toggle", { action: "update", id: row.id, expectedRevision: revision, data: { enabled } })}
      />
    </header>

    <div className="space-y-3 p-4">
      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <Info label="Inbound" value={row.capabilities.inbound === "webhook" ? "Telegram webhook" : "Discord interactions"}/>
        <Info label="Workflow" value={workflowName ?? (row.workflowId ? "Missing / inactive" : "Not linked")}/>
        <Info label="Default target" value={row.defaultTarget || "Not set"}/>
        <Info label="Last activity" value={row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString() : "No activity yet"}/>
      </div>

      <div className="rounded-lg border bg-muted/20 p-2.5">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate text-[10px]">{inboundPath}</code>
          <Button size="icon" variant="ghost" className="size-7" aria-label="Copy inbound URL" onClick={() => void navigator.clipboard?.writeText(window.location.origin + inboundPath)}>
            <Copy className="size-3"/>
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">{row.capabilities.notes}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)_auto]">
        <Input value={target} placeholder={row.provider === "telegram" ? "Chat ID" : "Channel ID"} onChange={(event) => setTarget(event.target.value)}/>
        <Input value={text} maxLength={row.provider === "telegram" ? 4096 : 2000} placeholder="Test message" onChange={(event) => setText(event.target.value)}/>
        <Button disabled={Boolean(busy) || !text.trim()} onClick={() => void run("send", { action: "send", id: row.id, target, text })}>
          <Send className="mr-2 size-3"/>Send
        </Button>
      </div>

      {row.lastCheck ? <p className={`text-xs ${row.lastCheck.ok ? "text-muted-foreground" : "text-destructive"}`}>{row.lastCheck.detail}</p> : null}
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>

    <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
      <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("test", { action: "test", id: row.id })}>
        <TestTube2 className="mr-2 size-3"/>Test
      </Button>
      {row.workflowId ? <Button size="sm" variant="ghost" disabled><Workflow className="mr-2 size-3"/>Linked</Button> : null}
      <div className="flex-1"/>
      <Button size="icon" variant="ghost" aria-label="Edit channel" onClick={onEdit}><Pencil className="size-3"/></Button>
      <Button size="icon" variant="ghost" aria-label="Delete channel" disabled={Boolean(busy)} onClick={() => {
        if (window.confirm(`Delete ${row.name}?`)) void run("delete", { action: "delete", id: row.id, expectedRevision: revision });
      }}><Trash2 className="size-3"/></Button>
    </footer>
  </article>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-0.5 truncate font-medium">{value}</div></div>;
}
