"use client";

import { useCallback, useEffect, useState } from "react";
import { Blocks, CheckCircle2, FolderSearch, HardDrive, Loader2, RefreshCw } from "lucide-react";
import { openWindow } from "@/features/appshell";
import type { DiscoveredLocalApp, LocalDiscoverySnapshot } from "@/lib/contracts/app-discovery";
import { modularFeatureAppId } from "@/lib/contracts/modular-feature";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useModularFeatureRegistry } from "../lib/modular-features";

export function LocalDiscoveryPanel({
  query,
  onConnectDetected,
}: {
  query: string;
  onConnectDetected: (app: DiscoveredLocalApp) => void;
}) {
  const [snapshot, setSnapshot] = useState<LocalDiscoverySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { snapshot: modular } = useModularFeatureRegistry();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/managed-apps/discover", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not scan apps on this computer.");
      setSnapshot((await res.json()) as LocalDiscoverySnapshot);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not scan apps on this computer.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void refresh(); });
    return () => cancelAnimationFrame(frame);
  }, [refresh]);

  const q = query.trim().toLowerCase();
  const detected = (snapshot?.apps ?? []).filter(
    (app) =>
      app.ownership !== "not-found" &&
      (!q || `${app.name} ${app.description} ${app.detectedPath ?? ""} ${app.detectedEndpoint ?? ""}`.toLowerCase().includes(q)),
  );
  const modularItems = modular.features.filter(
    (f) => !q || `${f.title} ${f.description ?? ""}`.toLowerCase().includes(q),
  );

  return (
    <section aria-label="Detected on this computer" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-medium">
            <HardDrive className="size-4 text-primary" aria-hidden />
            Detected on this computer
          </h3>
          <p className="text-xs text-muted-foreground">
            Apps already running or with saved data on this machine. Connect or open them without losing your data.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
          {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
          Scan host
        </Button>
      </div>

      {error && <p role="alert" className="text-xs text-destructive-text">{error}</p>}

      {loading && !snapshot ? (
        <p role="status" className="text-xs text-muted-foreground">Scanning local services, containers, and data folders...</p>
      ) : detected.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
          No existing local apps matched{q ? ` "${query}"` : ""}. Use Install and manage below to set up a new app, or Connect app for a remote server.
        </div>
      ) : (
        <div className="grid gap-3 @min-[640px]:grid-cols-2 @min-[960px]:grid-cols-3">
          {detected.map((app) => (
            <article key={app.id} className="min-w-0 space-y-2.5 rounded-xl border bg-card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <h4 className="truncate text-sm font-medium">{app.name}</h4>
                <Badge variant={app.running ? "default" : "secondary"} className="shrink-0 text-[10px]">
                  {app.ownership === "mso-managed"
                    ? app.running ? "Running (MSO)" : "Installed (Stopped)"
                    : app.running ? "Running locally" : "Data found"}
                </Badge>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{app.hint}</p>
              {(app.detectedEndpoint || app.detectedPath) && (
                <div className="space-y-0.5 rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                  {app.detectedEndpoint && <p className="truncate">Address: {app.detectedEndpoint}</p>}
                  {app.detectedPath && <p className="truncate">Folder: {app.detectedPath}</p>}
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-0.5">
                {app.managedAppId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={app.running ? "default" : "outline"}
                    onClick={() => openWindow(app.managedAppId!, app.name)}
                  >
                    {app.ownership === "mso-managed"
                      ? app.running ? "Open & manage" : "Open & start"
                      : "Open setup"}
                  </Button>
                ) : null}
                {app.ownership === "detected-local" && app.recommendedAction === "connect" && (
                  <Button type="button" size="sm" variant="outline" onClick={() => onConnectDetected(app)}>
                    <FolderSearch className="size-3.5" aria-hidden />
                    Connect
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {modularItems.length > 0 && (
        <div className="space-y-2 pt-1">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Blocks className="size-3.5" aria-hidden />
            Installed modular features (~/.mso/features)
          </h4>
          <div className="grid gap-2.5 @min-[640px]:grid-cols-2 @min-[960px]:grid-cols-3">
            {modularItems.map((feature) => (
              <article key={feature.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{feature.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">v{feature.version} · {feature.minRole}</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => openWindow(modularFeatureAppId(feature.id), feature.title)}>
                  <CheckCircle2 className="size-3.5" aria-hidden /> Open
                </Button>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
