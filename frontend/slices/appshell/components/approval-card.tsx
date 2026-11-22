"use client";

import { memo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  FolderPlus,
  FolderSearch,
  ListTree,
  Loader2,
  MemoryStick,
  Play,
  ShieldAlert,
  Terminal,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolStatus } from "./message-bubble";
import { canRememberAlfaTool } from "../lib/alfa-approval-policy";
import { ToolArgs, canonicalToolInput } from "./approval-card-args";

export { canonicalToolInput };

const TOOLS: Record<string, { label: string; icon: LucideIcon }> = {
  "fs.read": { label: "Reading file", icon: FileText },
  "fs.write": { label: "Saving file", icon: FilePlus },
  "fs.list": { label: "Listing files", icon: ListTree },
  "fs.search": { label: "Searching files", icon: FolderSearch },
  "fs.usage": { label: "Checking disk usage", icon: ListTree },
  "fs.mkdir": { label: "Creating folder", icon: FolderPlus },
  "fs.move": { label: "Moving file", icon: FileText },
  "fs.copy": { label: "Copying file", icon: FileText },
  "fs.delete": { label: "Deleting file", icon: Trash2 },
  "exec.run": { label: "Running command", icon: Terminal },
  "memory.remember": { label: "Remembering", icon: MemoryStick },
  "memory.forget": { label: "Forgetting", icon: MemoryStick },
  "skills.list": { label: "Listing skills", icon: ListTree },
  "skills.read": { label: "Reading skill", icon: FileText },
  "skills.search": { label: "Searching skills", icon: FolderSearch },
  "app.open": { label: "Opening app", icon: Play },
  "apps.list": { label: "Listing apps", icon: ListTree },
  "apps.logs": { label: "Reading app logs", icon: FileText },
  "apps.power": { label: "Toggling app", icon: Play },
  "browser.status": { label: "Checking browser", icon: Wrench },
  "browser.power": { label: "Toggling browser", icon: Play },
  "sys.stats": { label: "Reading system stats", icon: Wrench },
  "sys.processes": { label: "Listing processes", icon: Wrench },
};

const STATE: Record<ToolStatus, string> = {
  pending: "Needs your approval",
  running: "Working",
  ok: "Finished",
  error: "Needs attention",
  denied: "Denied",
};

export function toolIdentity(name: string): { label: string; icon: LucideIcon } {
  return TOOLS[name] ?? { label: name, icon: Wrench };
}

// Pending mutate calls stay fully expanded above Approve/Deny for safety audit.
// Completed read/mutate calls collapse into a clean step row you can expand on click.
export const ApprovalCard = memo(function ApprovalCard({
  message,
  onResolve,
}: {
  message: ChatMessage;
  onResolve: (id: string, approve: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const t = message.tool;
  if (!t) return null;
  const { label, icon: Icon } = toolIdentity(t.name);
  const pending = t.status === "pending";
  const bad = t.status === "error" || t.status === "denied";
  const isOpen = pending ? true : (expanded ?? t.status === "error");

  const headerContent = (
    <>
      {!pending ? (
        isOpen ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="font-medium">{label}</span>
      <code className="truncate text-[10px] text-muted-foreground/80">{t.name}</code>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          t.effect === "mutate" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {t.effect}
      </span>
      {t.status === "running" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
      {t.status === "ok" && <Check className="size-3.5 text-primary" aria-hidden />}
      {(t.status === "error" || t.status === "denied") && <X className="size-3.5 text-destructive" aria-hidden />}
      <span className={cn("ml-auto shrink-0 text-[10px]", bad ? "text-destructive" : "text-muted-foreground")}>
        {STATE[t.status]}
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        pending ? "border-primary/50 bg-primary/5" : bad ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40",
      )}
    >
      {pending ? (
        <div className="flex items-center gap-1.5">{headerContent}</div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(!isOpen)}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-1.5 text-left [@media(pointer:coarse)]:min-h-9"
        >
          {headerContent}
        </button>
      )}

      {isOpen ? (
        <>
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
        </>
      ) : null}

      {pending && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="h-7 px-2.5 text-xs [@media(pointer:coarse)]:min-h-[44px]" onClick={() => onResolve(message.id, true, remember)}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs [@media(pointer:coarse)]:min-h-[44px]" onClick={() => onResolve(message.id, false, false)}>
            Deny
          </Button>
          {!t.danger && t.approvalScope && canRememberAlfaTool(t.name, t.input) && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground [@media(pointer:coarse)]:min-h-11">
              <Switch checked={remember} onCheckedChange={setRemember} /> Always approve this exact call
            </label>
          )}
          {t.approvalScope ? <p className="w-full break-words text-[11px] text-muted-foreground">Scope: {t.name} + identical arguments · {t.approvalScope}</p> : null}
        </div>
      )}
    </div>
  );
});
