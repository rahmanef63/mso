"use client";

import { useEffect, useState } from "react";
import { Activity, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAlfaRunState } from "../lib/alfa-run-state";
import { stopAlfa, useAlfaBusy } from "../lib/alfa";

const LABELS = { working: "Working", waiting: "Waiting for approval", done: "Done", failed: "Failed", stopped: "Stopped" };
export function AlfaRunProgress() {
  const run = useAlfaRunState();
  const busy = useAlfaBusy();
  const [now, setNow] = useState(() => Date.now());
  const active = busy && run?.status === "working";
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!run) return null;
  // busy is the actual single-flight lock. Never infer active work from persisted cards.
  const status = run.status === "working" && !busy ? "stopped" : run.status;
  const seconds = Math.max(0, Math.floor(((run.finishedAt ?? now) - run.startedAt) / 1000));
  return (
    <section aria-label="Assistant run" className="shrink-0 border-b border-border bg-muted/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Activity aria-hidden className={active ? "size-3.5 motion-safe:animate-pulse text-primary" : "size-3.5 text-muted-foreground"} />
        <span role="status" className="font-medium">{LABELS[status]}</span>
        <span aria-label="Elapsed time" className="tabular-nums text-muted-foreground">{seconds}s elapsed</span>
        <div className="ml-auto flex items-center gap-1">
          <Sheet>
            <SheetTrigger asChild><Button variant="ghost" size="sm" className="[@media(pointer:coarse)]:min-h-11">Details</Button></SheetTrigger>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader><SheetTitle>Run details</SheetTitle>
                <SheetDescription>{LABELS[status]} · {seconds}s elapsed. Activity contains tool status only.</SheetDescription>
              </SheetHeader>
              <ol className="overflow-y-auto px-4 pb-4">
                {run.activities.map((row) => <li key={row.id} className="border-b border-border py-2">
                  <p className="break-words font-mono text-xs">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.state}</p>
                </li>)}
              </ol>
            </SheetContent>
          </Sheet>
          {busy && status !== "stopped" ? <Button variant="secondary" size="sm" onClick={stopAlfa} className="[@media(pointer:coarse)]:min-h-11"><Square className="size-3" />Stop</Button> : null}
        </div>
      </div>
      {status === "waiting" ? <p className="mt-1 break-words text-warning">Approval needed: {run.operation}. Processing is paused.</p> : null}
      {active ? <p className="mt-1 text-muted-foreground">{run.operation} · Last runner event {Math.max(0, Math.floor((now - run.heartbeatAt) / 1000))}s ago</p> : null}
      {status === "stopped" && busy ? <p className="mt-1 text-muted-foreground">Stop requested. An in-flight host operation may finish before the run closes.</p> : null}
      <ol aria-label="Recent activity" className="mt-1 space-y-0.5">
        {run.activities.slice(0, 4).map((row) => <li key={row.id} className="truncate text-muted-foreground">{row.label} · {row.state}</li>)}
      </ol>
    </section>
  );
}
