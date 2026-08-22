"use client";

import { Activity, CheckCircle2, XCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";

export type McpAuditRow = {
  ts?: string;
  action: string;
  actor?: string | null;
  target?: string;
  ok?: boolean;
  detail?: string;
};

export function McpAuditSection({ trail }: { trail: McpAuditRow[] }) {
  return (
    <SettingsSection
      icon={<Activity />}
      title="Recent activity"
      footnote={<>This forensic trail records privileged mutations and denials. Assistant → MCP shows the live stream for every tool call, including reads. Full trail: <code className="font-mono">mso audit</code>.</>}
    >
      <SettingsBlock className="p-0">
        <div className="flex min-h-[46px] items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
          <div>
            <p className="text-[13px] font-medium">Privileged MCP log</p>
            <p className="text-[10px] text-muted-foreground">Newest events first</p>
          </div>
          <span className="shrink-0 rounded-md bg-secondary px-2 py-1 text-[10px] text-muted-foreground">Latest {trail.length}</span>
        </div>
        {trail.length === 0 ? (
          <div className="grid min-h-32 place-items-center px-4 py-8 text-center text-xs text-muted-foreground">
            No privileged MCP activity yet.
          </div>
        ) : (
          <ScrollArea aria-label="MCP audit log" className="h-72 max-h-[42dvh]">
            <ul className="divide-y divide-border/60 pr-2">
              {trail.map((entry, index) => {
                const failed = entry.ok === false;
                const StatusIcon = failed ? XCircle : CheckCircle2;
                return (
                  <li key={`${entry.ts ?? "event"}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <StatusIcon className={failed ? "mt-0.5 size-3.5 text-destructive" : "mt-0.5 size-3.5 text-success"} />
                    <div className="min-w-0">
                      <code className={failed ? "font-mono text-[11px] font-medium text-destructive" : "font-mono text-[11px] font-medium"}>{entry.action}</code>
                      {(entry.target || entry.detail) && (
                        <p className="mt-0.5 line-clamp-2 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">{entry.target ?? entry.detail}</p>
                      )}
                      {entry.actor && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{entry.actor}</p>}
                    </div>
                    <time className="col-start-2 shrink-0 text-[10px] text-muted-foreground sm:col-start-3 sm:row-start-1">
                      {entry.ts ? new Date(entry.ts).toLocaleString() : ""}
                    </time>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </SettingsBlock>
    </SettingsSection>
  );
}
