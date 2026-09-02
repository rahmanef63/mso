"use client";

import { useState } from "react";
import { PanelRightClose, Sparkles, SlidersHorizontal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFocusedApp, useInspectorOpen } from "../../../hooks/use-shell";
import { setInspectorOpen } from "../../../lib/store";
import { useInspectorInfo } from "../../../lib/inspector";
import { useApp } from "../../../lib/registry";
import { AlfaThread } from "../../../components/alfa-thread";

type Tab = "props" | "ai";

// Right-docked "AI Inspector" — shared chrome for EVERY app. Reads the focused
// app's published descriptor (props + actions + AI context). Properties tab
// shows live state + quick actions; AI tab is a scoped Alfa chat.
export function Inspector() {
  const open = useInspectorOpen();
  const appId = useFocusedApp();
  const app = useApp(appId ?? "");
  const info = useInspectorInfo(appId);
  const [tab, setTab] = useState<Tab>("props");

  if (!open) return null;
  const subject = app?.title ?? appId ?? "Desktop";

  return (
    <aside className="absolute right-0 top-[30px] bottom-0 z-[40] flex w-[300px] max-w-[85vw] flex-col border-l border-border bg-card/80 backdrop-blur-xl">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="size-4 text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{subject}</p>
          {info?.subject ? (
            <p className="truncate text-[10px] text-muted-foreground">{info.subject}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close inspector (⌘I)"
          title="Close inspector (⌘I)"
          onClick={() => setInspectorOpen(false)}
          className="size-6 rounded text-muted-foreground hover:bg-secondary"
        >
          <PanelRightClose className="size-4" />
        </Button>
      </header>

      <div className="flex gap-1 border-b border-border p-1.5">
        <TabBtn icon={<SlidersHorizontal className="size-3.5" />} label="Properties" on={tab === "props"} onClick={() => setTab("props")} />
        <TabBtn icon={<Sparkles className="size-3.5" />} label="AI" on={tab === "ai"} onClick={() => setTab("ai")} />
      </div>

      <div className="min-h-0 flex-1">
        {tab === "props" ? (
          <PropsTab info={info} />
        ) : (
          // No key={appId} any more. That remount was what threw the conversation
          // away on every app switch — the opposite of watching Alfa carry a task
          // ACROSS features. The thread is shared and persistent now; only the
          // grounding context changes as the focused app changes.
          <AlfaThread
            ctx={{
              appId: appId ?? undefined,
              subject,
              context:
                (info?.context ?? "") +
                (info?.props?.length
                  ? ` Current state: ${info.props.map((p) => `${p.label}=${p.value}`).join(", ")}.`
                  : ""),
            }}
            placeholder={`Ask about ${subject}…`}
          />
        )}
      </div>
    </aside>
  );
}

function TabBtn({ icon, label, on, onClick }: { icon: React.ReactNode; label: string; on: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={cn(
        "h-auto flex-1 gap-1.5 rounded-md py-1.5 text-xs font-medium",
        on ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60",
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

function PropsTab({ info }: { info: ReturnType<typeof useInspectorInfo> }) {
  if (!info || (!info.props?.length && !info.actions?.length)) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">
        This app exposes no inspector properties.
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3">
        {info.props?.length ? (
          <dl className="space-y-1.5">
            {info.props.map((p) => (
              <div key={p.label} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="shrink-0 text-muted-foreground">{p.label}</dt>
                <dd className="truncate text-right font-mono">{p.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {info.actions?.length ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Actions
            </p>
            <div className="flex flex-wrap gap-1.5">
              {info.actions.map((a) => (
                <Button
                  key={a.id}
                  variant="outline"
                  onClick={() => void a.run()}
                  className="h-auto rounded-md px-2.5 py-1 text-xs"
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
