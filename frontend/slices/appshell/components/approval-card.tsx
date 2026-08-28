"use client";

import { useState } from "react";
import { Check, Loader2, ShieldAlert, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "./message-bubble";

// "Allow this exact call again" — mirrors REMEMBERABLE in use-host-commands.
const REMEMBERABLE = new Set(["fs.write", "fs.mkdir", "fs.move"]);

// Renders a role:"tool" message — one host tool call. A pending MUTATE call shows
// the full args + Approve/Deny (the agent loop is parked awaiting the click);
// reads and finished calls render as compact status chips. Colours use theme
// tokens only (primary = mutate/ok, destructive = denied/refused).
export function ApprovalCard({
  message,
  onResolve,
}: {
  message: ChatMessage;
  onResolve: (id: string, approve: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const t = message.tool;
  if (!t) return null;
  const pending = t.status === "pending";
  const bad = t.status === "error" || t.status === "denied";
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        pending ? "border-primary/50 bg-primary/5" : bad ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium">{t.name}</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            t.effect === "mutate" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {t.effect}
        </span>
        {t.status === "running" && <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />}
        {t.status === "ok" && <Check className="ml-auto size-3.5 text-primary" />}
        {(t.status === "error" || t.status === "denied") && <X className="ml-auto size-3.5 text-destructive" />}
      </div>

      <ToolArgs name={t.name} input={t.input} />

      {t.danger && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded bg-destructive/15 px-2 py-1 text-[11px] text-destructive">
          <ShieldAlert className="size-3.5 shrink-0" /> Server will refuse this: {t.danger}
        </div>
      )}

      {t.result && !pending && (
        <p className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
          {t.result.length > 600 ? `${t.result.slice(0, 600)}…` : t.result}
        </p>
      )}

      {pending && (
        <div className="mt-2 flex items-center gap-2">
          <Button type="button" size="sm" className="h-7 px-2.5 text-xs [@media(pointer:coarse)]:min-h-[44px]" onClick={() => onResolve(message.id, true, remember)}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs [@media(pointer:coarse)]:min-h-[44px]" onClick={() => onResolve(message.id, false, false)}>
            Deny
          </Button>
          {REMEMBERABLE.has(t.name) && (
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Switch checked={remember} onCheckedChange={setRemember} /> allow again
            </label>
          )}
        </div>
      )}
    </div>
  );
}

// The exact input object passed to the tool is the approval artifact. Mutation-critical
// values are never truncated; large values stay fully present inside a bounded scroll area.
export function canonicalToolInput(input: Record<string, unknown>): string {
  return JSON.stringify(input, null, 2);
}

function FullValue({ children }: { children: string }) {
  return (
    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 px-2 py-1 font-mono text-[10px]">
      {children}
    </pre>
  );
}

function ToolArgs({ name, input }: { name: string; input: Record<string, unknown> }) {
  if (name === "exec.run") {
    return (
      <div className="mt-1.5 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact command</p>
        <FullValue>{String(input.cmd ?? "")}</FullValue>
        {input.cwd !== undefined ? (
          <><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Working directory</p><FullValue>{String(input.cwd)}</FullValue></>
        ) : null}
      </div>
    );
  }
  if (name === "fs.write") {
    const content = String(input.content ?? "");
    const bytes = new TextEncoder().encode(content).byteLength;
    return (
      <div className="mt-1.5 text-[11px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact destination</p>
        <FullValue>{String(input.path ?? "")}</FullValue>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Full content ({bytes} bytes)</p>
        <FullValue>{content}</FullValue>
      </div>
    );
  }
  if (name === "fs.move" || name === "fs.copy") {
    return (
      <div className="mt-1.5 text-[11px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact source</p>
        <FullValue>{String(input.from ?? "")}</FullValue>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact destination</p>
        <FullValue>{String(input.to ?? "")}</FullValue>
      </div>
    );
  }
  if (name === "fs.delete" || name === "fs.mkdir") {
    return (
      <div className="mt-1.5 text-[11px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact path</p>
        <FullValue>{String(input.path ?? "")}</FullValue>
      </div>
    );
  }
  const canonical = canonicalToolInput(input);
  if (canonical === "{}") return null;
  return (
    <div className="mt-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Complete arguments</p>
      <FullValue>{canonical}</FullValue>
    </div>
  );
}
