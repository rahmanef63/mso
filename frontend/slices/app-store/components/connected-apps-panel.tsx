"use client";
import { useState } from "react";
import { Globe, Plus, RefreshCw } from "lucide-react";
import { FormDrawer, openWindow } from "@/features/appshell";
import { shellAppId, type ShellAppDefinition } from "@/lib/contracts/shell-app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useShellApps } from "../lib/shell-apps";
import { ConnectAppForm } from "./connect-app-form";
import { ImportAppManifest } from "./import-app-manifest";
import { ManagedAppsCatalog } from "./managed-apps-catalog";

export default function ConnectedAppsPanel() {
  const { active, snapshot, loading, error, refresh, mutate } = useShellApps();
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ShellAppDefinition | "new" | null>(null);
  const [removing, setRemoving] = useState<ShellAppDefinition | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const remove = async () => {
    if (!removing || busy) return;
    setBusy(true); setMessage("");
    try { await mutate({ action: "remove", id: removing.id }); setRemoving(null); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not disconnect app."); }
    finally { setBusy(false); }
  };
  if (!active) return <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">Sign in as the owner to install or connect apps on this host. Shell features and the MCP/Skills catalogs are available in their tabs.</div>;
  const apps = snapshot.apps.filter(app => `${app.title} ${app.description}`.toLowerCase().includes(query.toLowerCase()));
  return <ScrollArea className="h-full"><div className="@container space-y-6 p-4">
    <div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><h2 className="font-semibold">Apps on your host</h2><p className="text-sm text-muted-foreground">Install a supported app or connect a tool that is already running.</p></div><Button variant="ghost" size="icon" disabled={loading} aria-label="Refresh connected apps" onClick={() => void refresh()}><RefreshCw className="size-4"/></Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <ManagedAppsCatalog query={query}/>
    <section className="space-y-3" aria-label="Connected apps">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto font-medium">Connected apps</h3><Button variant="outline" disabled={!snapshot.configurable || loading} onClick={() => setImporting(true)}>Import manifest</Button><Button onClick={() => setEditing("new")} disabled={!snapshot.configurable || loading}><Plus className="size-4"/>Connect app</Button></div>
      <Input aria-label="Search connected apps" placeholder="Search connected apps" value={query} onChange={event => setQuery(event.target.value)}/>
      {!snapshot.configurable && !loading && !error && <p className="text-xs text-muted-foreground">This registry is managed by deployment configuration.</p>}
      {loading && !snapshot.revision ? <p role="status" className="text-sm text-muted-foreground">Loading apps…</p> : apps.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{query ? "No matching apps." : "No connected apps yet. Add the address of n8n or your own tool to open it from the shell."}</p> : <div className="grid gap-3 @min-[640px]:grid-cols-2">
        {apps.map(app => <article key={app.id} className="min-w-0 space-y-3 rounded-xl border p-4">
          <div className="flex items-center gap-2"><Globe className="size-5 shrink-0"/><h4 className="truncate font-medium">{app.title}</h4></div>
          {app.manifest && <p className="break-words text-xs text-muted-foreground">{app.manifest.id} · {app.manifest.version} · {app.manifest.publisher} (self-declared)</p>}
          {app.description && <p className="text-sm text-muted-foreground">{app.description}</p>}
          <p className="break-all text-xs text-muted-foreground">{app.origin}</p>
          <p className="text-xs text-muted-foreground">{app.blocked ? app.reason : app.renderer === "iframe" ? "Embedded app · service managed separately" : app.reason || "Opens in a separate tab"}</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => openWindow(shellAppId(app.id), app.title)} disabled={Boolean(app.blocked)}>Open</Button><Button size="sm" variant="outline" disabled={!snapshot.configurable} onClick={() => setEditing(app.definition)}>Edit</Button><Button size="sm" variant="ghost" disabled={!snapshot.configurable} onClick={() => { setMessage(""); setRemoving(app.definition); }}>Disconnect</Button></div>
        </article>)}
      </div>}
    </section>
    {importing && <ImportAppManifest onClose={() => setImporting(false)}/>}
    {editing && <ConnectAppForm existing={editing === "new" ? undefined : editing} onClose={() => setEditing(null)}/>}
    <FormDrawer open={Boolean(removing)} onOpenChange={open => { if (!open && !busy) setRemoving(null); }} size="sm">
      <FormDrawer.Header><FormDrawer.Title>Disconnect {removing?.title}?</FormDrawer.Title><FormDrawer.Description>This removes its shell entry. The application keeps running and its data is untouched.</FormDrawer.Description></FormDrawer.Header>
      {message && <p role="alert" className="px-4 text-sm text-destructive">{message}</p>}
      <FormDrawer.Footer><Button variant="ghost" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{busy ? "Disconnecting…" : "Disconnect"}</Button></FormDrawer.Footer>
    </FormDrawer>
  </div></ScrollArea>;
}
