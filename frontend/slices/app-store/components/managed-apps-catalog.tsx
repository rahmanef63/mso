"use client";
import { useEffect, useMemo, useState } from "react";
import { openWindow } from "@/features/appshell";
import type { AppCatalogEntry } from "@/lib/contracts/app-catalog";
import type { ManagedAppView } from "@/lib/managed-apps/types";
import { Button } from "@/components/ui/button";
import { ConnectAppForm } from "./connect-app-form";

type CatalogState = { status: "remote" | "stale" | "unavailable"; entries: AppCatalogEntry[] };

export function ManagedAppsCatalog({ query }: { query: string }) {
  const [apps, setApps] = useState<ManagedAppView[]>([]);
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [selected, setSelected] = useState<Extract<AppCatalogEntry, { kind: "connected" }> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/managed-apps", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load installable apps.");
      const data = await response.json() as { apps: ManagedAppView[] };
      setApps(data.apps); setError("");
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load apps."); });
    void fetch("/api/v1/app-catalog", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Catalog unavailable.");
      setCatalog(await response.json() as CatalogState);
    }).catch(() => { if (!controller.signal.aborted) setCatalog({ status: "unavailable", entries: [] }); });
    return () => controller.abort();
  }, []);

  const managedIds = useMemo(() => catalog?.entries.filter(entry => entry.kind === "managed").map(entry => entry.id) ?? [], [catalog]);
  const managed = apps.filter(app => (managedIds.length === 0 || managedIds.includes(app.id) || app.installed) &&
    app.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => {
      const left = managedIds.indexOf(a.id), right = managedIds.indexOf(b.id);
      return (left < 0 ? managedIds.length : left) - (right < 0 ? managedIds.length : right);
    });
  const connected = catalog?.entries.filter((entry): entry is Extract<AppCatalogEntry, { kind: "connected" }> =>
    entry.kind === "connected" && `${entry.manifest.title} ${entry.manifest.description}`.toLowerCase().includes(query.toLowerCase())) ?? [];

  return <section aria-label="Applications from MANEF" className="space-y-3">
    <h3 className="font-medium">Install and manage</h3>
    {catalog?.status === "stale" && <p role="status" className="text-xs text-muted-foreground">Showing the last valid MANEF catalog while it is unavailable.</p>}
    {catalog?.status === "unavailable" && <p role="status" className="text-xs text-muted-foreground">MANEF catalog is unavailable. Local reviewed installers remain available.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="grid gap-3 @min-[640px]:grid-cols-3">{managed.map(app => <article key={app.id} className="min-w-0 space-y-3 rounded-xl border p-4">
      <h4 className="font-medium">{app.name}</h4><p className="text-xs text-muted-foreground">{app.installed ? app.state : "Not installed"}</p>
      <p className="text-sm text-muted-foreground">{app.description}</p>
      {app.diagnostic && <p className="text-xs text-muted-foreground">{app.diagnostic}</p>}
      <Button size="sm" variant="outline" onClick={() => openWindow(app.id, app.name)}>{app.installed ? "Open and manage" : "Set up"}</Button>
    </article>)}</div>
    {connected.length > 0 && <div className="space-y-3">
      <h3 className="font-medium">Connect a running tool</h3>
      <div className="grid gap-3 @min-[640px]:grid-cols-2">{connected.map(entry => <article key={entry.manifest.id} className="min-w-0 space-y-3 rounded-xl border p-4">
        <h4 className="font-medium">{entry.manifest.title}</h4>
        <p className="text-sm text-muted-foreground">{entry.manifest.description}</p>
        <p className="text-xs text-muted-foreground">MANEF catalog template · no service installed</p>
        <Button size="sm" variant="outline" onClick={() => setSelected(entry)}>Review and connect</Button>
      </article>)}</div>
    </div>}
    <p className="text-xs text-muted-foreground">Managed setup uses the reviewed installer and checks this host. Connected tools keep their own service and sign-in; a domain is optional.</p>
    {selected && <ConnectAppForm manifest={selected.manifest} onClose={() => setSelected(null)}/>}
  </section>;
}
