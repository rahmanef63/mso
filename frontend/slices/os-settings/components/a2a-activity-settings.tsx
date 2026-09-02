"use client";

import { useMemo } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import {
  a2aTaskLabel,
  shortA2AId,
  type A2ASettingsState,
} from "./a2a-section-model";

export function A2AActivitySettings({ state }: { state: A2ASettingsState }) {
  const inboundNames = useMemo(
    () =>
      new Map(
        state.inboundTokens.map((token) => [`a2a:${token.id}`, token.label]),
      ),
    [state.inboundTokens],
  );
  return (
    <>
      <SettingsSection
        icon={<Activity />}
        title="Task activity"
        footnote="This owner view shows bounded A2A task metadata/activity. Remote peers can only read tasks created by their own inbound credential."
      >
        {state.tasks.length === 0 ? (
          <SettingsBlock className="py-4 text-xs text-muted-foreground">
            No inbound tasks yet.
          </SettingsBlock>
        ) : (
          state.tasks.slice(0, 20).map((task) => (
            <SettingsBlock
              key={task.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">
                    {a2aTaskLabel(task.status.state)}
                  </span>
                  {task.active && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">
                      live
                    </span>
                  )}
                  <code className="text-[10px] text-muted-foreground">
                    {task.scope}
                  </code>
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                  {shortA2AId(task.id)} ·{" "}
                  {inboundNames.get(task.principal) ??
                    shortA2AId(task.principal)}
                </p>
              </div>
              <time className="text-[10px] text-muted-foreground">
                {new Date(task.updatedAt).toLocaleString()}
              </time>
            </SettingsBlock>
          ))
        )}
      </SettingsSection>
      <SettingsSection icon={<ShieldCheck />} title="A2A audit">
        {state.activity.length === 0 ? (
          <SettingsBlock className="py-4 text-xs text-muted-foreground">
            No A2A audit events yet.
          </SettingsBlock>
        ) : (
          state.activity.slice(0, 20).map((entry, index) => (
            <SettingsBlock
              key={entry.id ?? `${entry.ts}-${index}`}
              className="py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="text-[10px] font-medium">
                  {entry.action ?? "a2a"}
                </code>
                <span className="text-[10px] text-muted-foreground">
                  {entry.ts ? new Date(entry.ts).toLocaleString() : ""}
                </span>
              </div>
              <p className="mt-1 break-words text-[11px] text-muted-foreground">
                {entry.detail ?? entry.target ?? "—"}
              </p>
            </SettingsBlock>
          ))
        )}
      </SettingsSection>
    </>
  );
}
