"use client";

import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { JobPhase, JobState } from "./update-machine";

export type StepStatus = "pending" | "active" | "done" | "failed";

export interface AppDeckStep {
  id: string;
  label: string;
  status: StepStatus;
}

const FLOWS: Record<string, { id: string; label: string }[]> = {
  install: [
    { id: "download", label: "Verify package" },
    { id: "apply", label: "Install & configure" },
    { id: "health", label: "Start & health check" },
    { id: "ready", label: "Ready" },
  ],
  update: [
    { id: "quiesce", label: "Pause safely" },
    { id: "backup", label: "Save backup" },
    { id: "apply", label: "Apply verified update" },
    { id: "ready", label: "Restart & verify" },
  ],
  uninstall: [
    { id: "quiesce", label: "Pause safely" },
    { id: "backup", label: "Save backup" },
    { id: "apply", label: "Remove runtime" },
    { id: "ready", label: "Done" },
  ],
  restore: [
    { id: "quiesce", label: "Pause safely" },
    { id: "backup", label: "Save safety copy" },
    { id: "apply", label: "Restore files" },
    { id: "ready", label: "Resume app" },
  ],
};

function flowFor(kind: string | null): { id: string; label: string }[] {
  const normalized = (kind ?? "").toLowerCase();
  if (normalized.includes("uninstall")) return FLOWS.uninstall!;
  if (normalized.includes("restore") || normalized.includes("rollback")) return FLOWS.restore!;
  if (normalized.includes("install")) return FLOWS.install!;
  return FLOWS.update!;
}

function highestMarkerIndex(kind: string | null, log: string): number {
  const normalized = (kind ?? "").toLowerCase();
  const has = (pattern: RegExp) => pattern.test(log);

  if (normalized.includes("install") && !normalized.includes("uninstall")) {
    if (has(/step=ready|healthy after|install finished|ready on/i)) return 3;
    if (has(/step=health|wait for|waiting for|healthz|api\/health/i)) return 2;
    if (has(/step=apply|recreate|starting|installing the|running onboard|enabling and starting/i)) return 1;
    return 0;
  }

  if (normalized.includes("restore") || normalized.includes("rollback")) {
    if (has(/step=recover|back online|undo this with backup/i)) return 3;
    if (has(/restored \d+ files/i)) return 2;
    if (has(/current state saved|restoring /i)) return 1;
    return 0;
  }

  if (has(/step=ready|healthy after|removed container|removed |finished/i)) return 3;
  if (has(/step=apply|step=download|step=health|==> pull|==> recreate|reconciling/i)) return 2;
  if (has(/step=backup|\[mso\] pre-|\[mso\] backup |nothing to back up/i)) return 1;
  return 0;
}

export function parseAppDeckSteps(kind: string | null, log: string, phase: JobPhase): AppDeckStep[] {
  const template = flowFor(kind);
  if (phase === "succeeded") {
    return template.map((item) => ({ ...item, status: "done" }));
  }
  const current = highestMarkerIndex(kind, log);
  return template.map((item, index) => {
    if (phase === "failed" || phase === "interrupted") {
      if (index < current) return { ...item, status: "done" };
      if (index === current) return { ...item, status: "failed" };
      return { ...item, status: "pending" };
    }
    if (index < current) return { ...item, status: "done" };
    if (index === current) return { ...item, status: "active" };
    return { ...item, status: "pending" };
  });
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "failed") return <XCircle className="size-3.5 shrink-0 text-destructive" aria-hidden />;
  if (status === "active") return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />;
  return <Circle className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />;
}

export function AppDeckStepper({ job }: { job: JobState }) {
  const steps = parseAppDeckSteps(job.kind, job.log, job.phase);
  return (
    <ol aria-label="AppDeck progress" className="mb-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
            step.status === "active"
              ? "border-primary/40 bg-primary/10 font-medium text-foreground"
              : step.status === "failed"
                ? "border-destructive/40 bg-destructive/10 font-medium text-destructive"
                : step.status === "done"
                  ? "border-border bg-background/60 text-foreground"
                  : "border-border/50 bg-transparent text-muted-foreground"
          }`}
        >
          <StepIcon status={step.status} />
          <span className="truncate">
            {index + 1}. {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
