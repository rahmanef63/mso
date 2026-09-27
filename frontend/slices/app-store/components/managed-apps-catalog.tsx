"use client";
import { useEffect, useState } from "react";
import { openWindow } from "@/features/appshell";
import type { ManagedAppView } from "@/lib/managed-apps/types";
import { Button } from "@/components/ui/button";

export function ManagedAppsCatalog({ query }: { query: string }) {
  const [apps, setApps] = useState<ManagedAppView[]>([]), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/managed-apps", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load installable apps.");
      const data = await response.json() as { apps: ManagedAppView[] };
      setApps(data.apps); setError("");
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load apps."); });
    return () => controller.abort();
  }, []);
  return <section aria-label="Managed applications" className="space-y-3">
    <h3 className="font-medium">Install and manage</h3>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="grid gap-3 @min-[640px]:grid-cols-3">{apps.filter(app => app.name.toLowerCase().includes(query.toLowerCase())).map(app => <article key={app.id} className="min-w-0 space-y-3 rounded-xl border p-4">
      <h4 className="font-medium">{app.name}</h4><p className="text-xs text-muted-foreground">{app.installed ? app.state : "Not installed"}</p>
      <p className="text-sm text-muted-foreground">{app.description}</p>
      {app.diagnostic && <p className="text-xs text-muted-foreground">{app.diagnostic}</p>}
      <Button size="sm" variant="outline" onClick={() => openWindow(app.id, app.name)}>{app.installed ? "Open and manage" : "Set up"}</Button>
    </article>)}</div>
    <p className="text-xs text-muted-foreground">Setup uses the reviewed installer and checks the host before installation. Other running tools can be connected below.</p>
  </section>;
}
