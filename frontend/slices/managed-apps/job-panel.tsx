"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Loader2, PlugZap, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppDeckStepper } from "./appdeck-stepper";
import { fmtStamp } from "./app-support";
import { isTerminal, statusLine, type JobState } from "./update-machine";

const TONE: Record<string, string> = {
  succeeded: "border-border bg-muted/40",
  failed: "border-destructive/40 bg-destructive/10",
  interrupted: "border-border bg-muted/40",
};

function PhaseIcon({ phase }: { phase: JobState["phase"] }) {
  if (phase === "succeeded") return <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />;
  if (phase === "failed") return <XCircle className="size-4 text-destructive" aria-hidden />;
  if (phase === "interrupted") return <PlugZap className="size-4" aria-hidden />;
  return <Loader2 className="size-4 animate-spin" aria-hidden />;
}

/** Live AppDeck job progress: human-readable stepper, aria-live status line,
 *  and technical logs tucked inside a collapsible disclosure. */
export function JobPanel({ job, onDismiss, onCancel }: { job: JobState; onDismiss: () => void; onCancel?: (() => void) | null }) {
  const tail = useRef<HTMLPreElement>(null);
  const done = isTerminal(job.phase);

  useEffect(() => {
    const node = tail.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [job.log]);

  if (job.phase === "idle") return null;

  return (
    <section className={`mt-3 rounded-lg border p-3 ${TONE[job.phase] ?? "border-border bg-muted/40"}`}>
      <AppDeckStepper job={job} />
      <div className="flex items-start gap-2">
        <PhaseIcon phase={job.phase} />
        <p role="status" aria-live="polite" className="min-w-0 flex-1 text-xs leading-relaxed">
          {statusLine(job)}
        </p>
        {done ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>

      {job.warning ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {job.warning}
        </p>
      ) : null}

      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {job.jobId ? (
          <div className="flex gap-1">
            <dt>Job</dt>
            <dd className="font-mono">{job.jobId.slice(0, 8)}</dd>
          </div>
        ) : null}
        {job.startedAt ? (
          <div className="flex gap-1">
            <dt>Started</dt>
            <dd>{fmtStamp(job.startedAt)}</dd>
          </div>
        ) : null}
        {job.endedAt ? (
          <div className="flex gap-1">
            <dt>Ended</dt>
            <dd>{fmtStamp(job.endedAt)}</dd>
          </div>
        ) : null}
        {job.exitCode !== null ? (
          <div className="flex gap-1">
            <dt>Exit code</dt>
            <dd className="font-mono">{job.exitCode}</dd>
          </div>
        ) : null}
      </dl>

      {job.log ? (
        <details open={job.phase === "failed" || job.phase === "interrupted"} className="mt-2">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
            Technical output
          </summary>
          <pre
            ref={tail}
            tabIndex={0}
            aria-label="Job output"
            className="mt-1.5 max-h-56 overflow-auto rounded-md bg-secondary p-2 text-[10px] leading-relaxed whitespace-pre-wrap break-words text-secondary-foreground"
          >
            {job.log}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
