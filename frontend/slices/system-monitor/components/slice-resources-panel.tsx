"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOsApi, type SliceResourceReport, type SliceResourceRow } from "../lib/host";
import { GlassPanel } from "./glass-panel";
import { cn } from "@/lib/utils";

/**
 * Worst offenders across feature slices: declared budget vs what the capability
 * ledger actually measured.
 *
 * Deliberately not a chart. Every row carries its own evidence label, because a
 * number with no provenance must not look like a measurement. Reuses GlassPanel so
 * this panel has no visual language of its own.
 */
export function SliceResourcesPanel() {
  const api = useOsApi();
  const [report, setReport] = useState<SliceResourceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setReport(await api.sys.sliceResources());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api]);

  useEffect(() => {
    let alive = true;
    api.sys
      .sliceResources()
      .then((value) => { if (alive) setReport(value); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; };
  }, [api]);

  if (!report && !error) {
    return <div className="flex h-full items-center justify-center gap-2 p-8 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />Reading slice ledger…</div>;
  }
  if (error) {
    return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"><AlertCircle className="size-6 text-destructive" /><p className="text-xs text-muted-foreground">{error}</p><Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></div>;
  }
  if (!report) return null;

  const rows = report.worst.length > 0 ? report.worst : report.slices.slice(0, 5);

  return (
    <div className="space-y-3.5 p-4">
      <div className="rounded-lg border border-border bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
        Every value is labelled. <strong>measured</strong> means a real capability call was recorded;
        <strong> estimated</strong> is arithmetic over those measurements; <strong>under-sampled</strong> means
        too little time has passed to state a rate; <strong>not-instrumented</strong> means MSO does not
        measure it yet. Enforcement is {report.enforcement.enabled ? "on" : "off"}.
      </div>

      {report.unaccountedSlices.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-xs text-destructive-text">
          {report.unaccountedSlices.length} slice(s) have no budget entry and report as unknown, not free: {report.unaccountedSlices.join(", ")}.
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-[color:var(--text-faint)]">No slice activity recorded in this process yet.</p>
      ) : (
        <GlassPanel title="Slice cost" right={`${report.slices.length} registered`}>
          <ul className="divide-y divide-[color:var(--sep)]">
            {rows.map((row) => <SliceRow key={row.slice} row={row} />)}
          </ul>
        </GlassPanel>
      )}

      <p className="text-[11px] leading-relaxed text-[color:var(--text-faint)]">
        {report.unaccounted.calls > 0
          ? `${report.unaccounted.calls} capability call(s) had no owning slice and are excluded from every slice total.`
          : "Every recorded call was attributable to a slice."}
        {report.droppedSamples > 0 ? ` ${report.droppedSamples} older sample(s) were evicted from the ${report.bufferCapacity}-sample buffer.` : ""}
      </p>
    </div>
  );
}

export function SliceRow({ row }: { row: SliceResourceRow }) {
  const over = row.fields.some((f) => f.status === "over");
  const calls = row.fields.find((f) => f.field === "externalCallsPerMinute");
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("truncate text-[12.5px] font-semibold", over ? "text-destructive-text" : "text-foreground")}>{row.slice}</span>
        <span className="shrink-0 font-mono text-[11px] text-[color:var(--text-dim)]">
          {calls ? `${String(calls.actual ?? "?")} / ${String(calls.budget ?? "?")} calls/min` : `${row.calls} calls`}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        {row.fields.map((f) => (
          <span
            key={f.field}
            className={cn(
              "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
              f.status === "over" ? "bg-destructive/15 text-destructive-text"
                : f.evidence === "not-instrumented" || f.evidence === "undeclared" || f.evidence === "under-sampled" ? "bg-[color:var(--inset)] text-[color:var(--text-faint)]"
                : "bg-[color:var(--inset)] text-[color:var(--text-dim)]",
            )}
            title={`${f.evidence}: ${f.provenance.note} (${f.provenance.file}:${f.provenance.line})`}
          >
            {f.field} · {f.evidence}
          </span>
        ))}
      </div>
    </li>
  );
}
