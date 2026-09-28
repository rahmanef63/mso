"use client";
import { useId, useState, type FormEvent } from "react";
import { FormDrawer } from "@/features/appshell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ConnectedAppManifest } from "@/lib/contracts/connected-app-manifest";
import type { ShellAppDefinition } from "@/lib/contracts/shell-app";
import { useShellApps } from "../lib/shell-apps";

export function ConnectAppForm({ existing, manifest, onClose }: { existing?: ShellAppDefinition; manifest?: ConnectedAppManifest; onClose: () => void }) {
  const prefix = useId(), { mutate } = useShellApps();
  const [app, setApp] = useState<ShellAppDefinition>(existing ?? { id: manifest?.id ?? "", title: manifest?.title ?? "", description: manifest?.description ?? "", url: "", mode: manifest?.presentation ?? "embed" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const change = (key: keyof ShellAppDefinition, value: string) => setApp(current => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await mutate(manifest ? { action: "import", manifest, binding: { id: app.id, url: app.url, mode: app.mode } } : { action: existing ? "update" : "add", app }); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not connect app."); }
    finally { setBusy(false); }
  };
  return <FormDrawer open onOpenChange={open => { if (!open && !busy) onClose(); }} size="md">
    <FormDrawer.Header><FormDrawer.Title>{existing ? "Edit connected app" : "Connect a running app"}</FormDrawer.Title><FormDrawer.Description>Add your own tool or an existing service to this shell. The application keeps running on its host.</FormDrawer.Description></FormDrawer.Header>
    <form onSubmit={submit} className="min-h-0 space-y-4 overflow-y-auto px-4 pb-4">
      {manifest && <div className="space-y-1 rounded-lg border p-3 text-sm"><p>Manifest: {manifest.id} · {manifest.version}</p><p>Publisher: {manifest.publisher} (self-declared)</p><p className="text-xs text-muted-foreground">Review this source before connecting. Use a different App ID for each instance. No tools or credentials are granted.</p></div>}
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-name`}>App name</Label><Input id={`${prefix}-name`} value={app.title} readOnly={Boolean(manifest)} maxLength={120} required onChange={event => {
        const title = event.target.value;
        setApp(current => ({ ...current, title, ...(!existing && (!current.id || current.id === current.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) ? { id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) } : {}) }));
      }}/></div>
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-id`}>App ID</Label><Input id={`${prefix}-id`} value={app.id} readOnly={Boolean(existing)} pattern="[a-z0-9][a-z0-9-]{0,63}" maxLength={64} required onChange={event => change("id", event.target.value)} /><p className="text-xs text-muted-foreground">A unique name using lowercase letters, numbers and hyphens.</p></div>
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-url`}>App URL</Label><Input id={`${prefix}-url`} type="url" value={app.url} placeholder="https://your-app.example or http://192.168.1.10:5678" maxLength={2048} required onChange={event => change("url", event.target.value)} /><p className="text-xs text-muted-foreground">Use an address reachable from this browser. A domain is optional. HTTP addresses open in a separate tab. Do not include tokens or passwords.</p></div>
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-description`}>Description</Label><Input id={`${prefix}-description`} value={app.description} readOnly={Boolean(manifest)} maxLength={240} onChange={event => change("description", event.target.value)} /></div>
      <div className="flex items-center gap-2"><Switch aria-label="Embed HTTPS app inside MSO" checked={app.mode === "embed"} onCheckedChange={checked => change("mode", checked === true ? "embed" : "tab")} /><span className="text-sm">Embed HTTPS app inside MSO</span></div>
      <p className="text-xs text-muted-foreground">The app keeps its own sign-in. Some apps block embedding; Open in new tab remains available. Connecting does not install or stop a service.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Connect app"}</Button></div>
    </form>
  </FormDrawer>;
}
