"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { featureFetch } from "@/lib/os-api";
import type { ManagedAppId } from "@/lib/managed-apps/types";

export interface PreflightCheckItem {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fixHint?: string;
}

export interface PreflightReport {
  appId: ManagedAppId;
  appName: string;
  installed: boolean;
  ready: boolean;
  summary: string;
  backend: "user-systemd" | "docker" | null;
  checks: PreflightCheckItem[];
  checkedAt: string;
}

function StatusIcon({ status }: { status: PreflightCheckItem["status"] }) {
  if (status === "pass") return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "warn") return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />;
  return <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />;
}

export function AppDeckPreflightCard({
  appId,
  onReadyChange,
}: {
  appId: ManagedAppId;
  onReadyChange?: (ready: boolean) => void;
}) {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await featureFetch<PreflightReport>(`/api/v1/managed-apps/${appId}/preflight`, { cache: "no-store" });
      setReport(data);
      setError(null);
      onReadyChange?.(data.ready);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check host readiness");
      onReadyChange?.(true);
    } finally {
      setLoading(false);
    }
  }, [appId, onReadyChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading && !report) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Checking host readiness for {appId}...
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>{error}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className="size-3" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  if (!report) return null;

  return (
    <section
      aria-label="AppDeck host readiness"
      className={`rounded-lg border p-3 ${
        report.ready ? "border-border bg-muted/30" : "border-amber-500/40 bg-amber-500/10"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-foreground">
            {report.ready ? "Host ready for AppDeck install" : "Host needs attention before install"}
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{report.summary}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
          aria-label="Re-check host readiness"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </Button>
      </div>

      <ul className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2">
        {report.checks.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-[11px]">
            <StatusIcon status={item.status} />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-foreground">{item.label}:</span>{" "}
              <span className="text-muted-foreground">{item.detail}</span>
              {item.fixHint && item.status !== "pass" ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">How to fix: {item.fixHint}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
