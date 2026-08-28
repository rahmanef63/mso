"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, PackageSearch, RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useOsApi, type PackageUpdateSummary } from "../lib/host";

export function PackageUpdatesPanel() {
  const api = useOsApi();
  const [summary, setSummary] = useState<PackageUpdateSummary | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSummary(await api.sys.packageUpdates());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api]);
  useEffect(() => {
    let alive = true;
    api.sys.packageUpdates()
      .then((value) => { if (alive) setSummary(value); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; };
  }, [api]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (summary?.updates ?? []).filter((item) => !needle || `${item.name} ${item.current ?? ""} ${item.candidate}`.toLowerCase().includes(needle));
  }, [summary, query]);

  if (!summary && !error) return <div className="flex h-full items-center justify-center gap-2 p-8 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />Reading local package cache…</div>;
  if (error) return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"><AlertCircle className="size-6 text-destructive" /><p className="text-xs text-muted-foreground">{error}</p><Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></div>;

  return (
    <div className="space-y-3.5 p-4">
      <div className="rounded-lg border border-border bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
        Visibility only. MSO reads the package manager&apos;s existing local cache and never runs refresh, install, or upgrade from this panel.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search package updates" className="pl-8" />
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}><RotateCw className="size-3.5" /> Check cache</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <PackageSearch className="size-4" />
        <strong className="text-foreground">{summary?.updates.length ?? 0}</strong> updates
        <Badge variant="outline">{summary?.manager ?? "unsupported"}</Badge>
        <Badge variant="outline">local cache</Badge>
      </div>
      {summary?.diagnostic && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">{summary.diagnostic}</p>}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/45">
        {rows.map((item) => (
          <div key={`${item.name}:${item.architecture ?? ""}`} className="grid gap-1 p-3 text-xs sm:grid-cols-[minmax(8rem,1fr)_minmax(9rem,auto)_auto] sm:items-center">
            <div className="min-w-0"><p className="truncate font-mono font-semibold text-foreground">{item.name}</p>{item.architecture && <p className="text-[10px] text-muted-foreground">{item.architecture}</p>}</div>
            <p className="break-all font-mono text-[11px] text-muted-foreground">{item.current || "installed version unavailable"} → <span className="text-foreground">{item.candidate}</span></p>
            <Badge variant="secondary">available</Badge>
          </div>
        ))}
        {!rows.length && <p className="p-8 text-center text-xs text-muted-foreground">{summary?.available ? "No matching cached updates." : "Package cache is unavailable."}</p>}
      </div>
      {summary?.truncated && <p className="text-xs text-muted-foreground">Result capped for safety. Narrow the search or use the owner terminal for a full listing.</p>}
    </div>
  );
}
