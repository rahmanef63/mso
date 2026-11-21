"use client";

import { useEffect, useMemo, useState } from "react";
import { CopyButton, FormDrawer, openWindow } from "@/features/appshell";
import type { AppCatalogEntry } from "@/lib/contracts/app-catalog";
import type { ManagedAppView } from "@/lib/managed-apps/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectAppForm } from "./connect-app-form";

type CatalogState = { status: "remote" | "stale" | "unavailable"; entries: AppCatalogEntry[] };

function statusLabel(app: ManagedAppView): string {
  if (!app.installed) return "Not installed";
  if (app.state === "running") return "Running";
  if (app.state === "starting") return "Starting";
  if (app.state === "stopped") return "Stopped";
  if (app.state === "unhealthy") return "Unhealthy";
  return app.state;
}

export function ManagedAppsCatalog({ query }: { query: string }) {
  const [apps, setApps] = useState<ManagedAppView[]>([]);
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [selected, setSelected] = useState<Extract<AppCatalogEntry, { kind: "connected" }> | null>(null);
  const [domainInfo, setDomainInfo] = useState<ManagedAppView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadApps = async () => {
      try {
        const response = await fetch("/api/v1/managed-apps", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load installable apps.");
        const data = (await response.json()) as { apps: ManagedAppView[] };
        setApps(data.apps);
        setError("");
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load apps.");
      }
    };

    void loadApps();
    void fetch("/api/v1/app-catalog", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalog unavailable.");
        setCatalog((await response.json()) as CatalogState);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalog({ status: "unavailable", entries: [] });
      });

    const refreshVisible = () => {
      if (!document.hidden) void loadApps();
    };
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
    };
  }, []);

  const managedIds = useMemo(
    () => catalog?.entries.filter((entry) => entry.kind === "managed").map((entry) => entry.id) ?? [],
    [catalog],
  );
  const q = query.trim().toLowerCase();
  const managed = apps
    .filter((app) => !q || `${app.name} ${app.description}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const left = managedIds.indexOf(a.id);
      const right = managedIds.indexOf(b.id);
      return (left < 0 ? managedIds.length : left) - (right < 0 ? managedIds.length : right);
    });
  const connected =
    catalog?.entries.filter(
      (entry): entry is Extract<AppCatalogEntry, { kind: "connected" }> =>
        entry.kind === "connected" &&
        `${entry.manifest.title} ${entry.manifest.description}`.toLowerCase().includes(q),
    ) ?? [];

  return (
    <section aria-label="Applications from MANEF" className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="font-medium">Install and manage</h3>
        <p className="text-xs text-muted-foreground">
          External applications controlled by MSO (install, start, stop, update, backup, and uninstall) without copying their source into MSO.
        </p>
      </div>
      {catalog?.status === "stale" && (
        <p role="status" className="text-xs text-muted-foreground">
          Showing the last valid MANEF catalog while it is unavailable.
        </p>
      )}
      {catalog?.status === "unavailable" && (
        <p role="status" className="text-xs text-muted-foreground">
          MANEF catalog is unavailable. Local reviewed installers remain available.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
      <div className="grid gap-3 @min-[640px]:grid-cols-2 @min-[960px]:grid-cols-3">
        {managed.map((app) => (
          <article key={app.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="truncate font-medium">{app.name}</h4>
              <Badge variant={app.state === "running" ? "default" : "secondary"} className="shrink-0 text-[10px]">
                {statusLabel(app)}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{app.description}</p>
            {app.publicDashboardUrl && (
              <p className="truncate font-mono text-[11px] text-muted-foreground">{app.publicDashboardUrl}</p>
            )}
            {app.diagnostic && <p className="text-xs text-muted-foreground">{app.diagnostic}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={app.installed ? "default" : "outline"} onClick={() => openWindow(app.id, app.name)}>
                {app.installed ? "Open and manage" : "Set up"}
              </Button>
              {app.installed && (
                <Button size="sm" variant="ghost" onClick={() => setDomainInfo(app)}>
                  {app.domain?.phase === "ready" ? "Domain active" : "Domain info"}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {connected.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium">Connect a running tool</h3>
          <div className="grid gap-3 @min-[640px]:grid-cols-2">
            {connected.map((entry) => (
              <article key={entry.manifest.id} className="min-w-0 space-y-3 rounded-xl border p-4">
                <h4 className="font-medium">{entry.manifest.title}</h4>
                <p className="text-sm text-muted-foreground">{entry.manifest.description}</p>
                <p className="text-xs text-muted-foreground">MANEF catalog template · no service installed</p>
                <Button size="sm" variant="outline" onClick={() => setSelected(entry)}>
                  Review and connect
                </Button>
              </article>
            ))}
          </div>
        </div>
      )}
      {selected && <ConnectAppForm manifest={selected.manifest} onClose={() => setSelected(null)} />}
      <FormDrawer open={Boolean(domainInfo)} onOpenChange={(open) => { if (!open) setDomainInfo(null); }} size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>{domainInfo?.name} split-origin domain</FormDrawer.Title>
          <FormDrawer.Description>
            Managed applications use split-origin routing configured through MSO managed domains so their cookies stay isolated from MSO.
          </FormDrawer.Description>
        </FormDrawer.Header>
        {domainInfo && (
          <div className="space-y-3 px-4 pb-4 text-xs">
            <div className="rounded-lg border p-3 space-y-1">
              <p><strong>Status:</strong> {domainInfo.domain?.phase ?? "Not provisioned yet"}</p>
              {domainInfo.domain?.hostname && <p className="break-all"><strong>Hostname:</strong> https://{domainInfo.domain.hostname}</p>}
              {domainInfo.domainDiagnostic && <p className="text-destructive-text">{domainInfo.domainDiagnostic}</p>}
            </div>
            <p className="text-muted-foreground">Run this command in Terminal to provision or check its Cloudflare Tunnel hostname:</p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[11px]">mso domain ensure {domainInfo.id} --apply</code>
              <CopyButton value={`mso domain ensure ${domainInfo.id} --apply`} label="domain command" />
            </div>
          </div>
        )}
        <FormDrawer.Footer>
          <Button type="button" variant="outline" onClick={() => setDomainInfo(null)}>Close</Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </section>
  );
}
