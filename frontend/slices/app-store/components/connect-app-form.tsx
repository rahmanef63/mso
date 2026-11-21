"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { FormDrawer } from "@/features/appshell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ConnectedAppManifest } from "@/lib/contracts/connected-app-manifest";
import type { RemoteProbeResult } from "@/lib/contracts/remote-connect";
import type { ShellAppDefinition } from "@/lib/contracts/shell-app";
import { useShellApps } from "../lib/shell-apps";
import { hostnameFromUrl } from "../lib/app-domain";
import { AppDomainStep } from "./app-domain-step";

const PRESETS: Array<{ label: string; sample: Partial<ShellAppDefinition> }> = [
  { label: "Local port app", sample: { title: "Local Web App", id: "local-web-app", url: "http://127.0.0.1:8080", description: "App running on this computer", mode: "tab" } },
  { label: "Remote HTTPS app", sample: { title: "Remote Dashboard", id: "remote-dashboard", url: "https://app.example.com", description: "External HTTPS web application", mode: "embed" } },
];

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);

export function ConnectAppForm({ existing, manifest, prefill, onClose }: {
  existing?: ShellAppDefinition;
  manifest?: ConnectedAppManifest;
  prefill?: Partial<ShellAppDefinition>;
  onClose: () => void;
}) {
  const prefix = useId();
  const { mutate } = useShellApps();
  const [app, setApp] = useState<ShellAppDefinition>(
    existing ?? {
      id: manifest?.id ?? prefill?.id ?? "",
      title: manifest?.title ?? prefill?.title ?? "",
      description: manifest?.description ?? prefill?.description ?? "",
      url: prefill?.url ?? "",
      mode: manifest?.presentation ?? prefill?.mode ?? "embed",
    },
  );
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<RemoteProbeResult | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState<{ id: string; title: string; url: string } | null>(null);

  const change = (key: keyof ShellAppDefinition, value: string) =>
    setApp((current) => ({ ...current, [key]: value }));

  const testAddress = async () => {
    const raw = app.url.trim();
    if (!raw) return;
    setTesting(true); setError(""); setProbe(null);
    try {
      const mode = raw.startsWith("https://") ? "https-url" : "local-existing";
      const res = await fetch("/api/v1/managed-apps/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "https-url" ? { mode, url: raw } : { mode, endpoint: raw }),
      });
      const data = (await res.json()) as RemoteProbeResult;
      setProbe(data);
      if (data.recommendation?.embedMode === "remote") change("mode", "tab");
    } catch { setError("Could not test this address right now."); }
    finally { setTesting(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await mutate(
        manifest
          ? { action: "import", manifest, binding: { id: app.id, url: app.url, mode: app.mode } }
          : { action: existing ? "update" : "add", app },
      );
      if (existing) onClose();
      else setConnected({ id: app.id, title: app.title, url: app.url });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not connect app.");
    } finally { setBusy(false); }
  };

  if (connected) {
    return (
      <AppDomainStep
        appId={connected.id}
        appTitle={connected.title}
        defaultHostname={hostnameFromUrl(connected.url)}
        appAddress={connected.url}
        onDone={onClose}
      />
    );
  }

  return (
    <FormDrawer open onOpenChange={(open) => { if (!open && !busy) onClose(); }} size="md">
      <FormDrawer.Header>
        <FormDrawer.Title>{existing ? "Edit connected app" : "Connect a running app"}</FormDrawer.Title>
        <FormDrawer.Description>
          Link an app already running on this computer or a remote server. MSO will never stop or delete it.
        </FormDrawer.Description>
      </FormDrawer.Header>
      <form onSubmit={submit} className="min-h-0 space-y-3.5 overflow-y-auto px-4 pb-4">
        {!existing && !manifest && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Fill example:</span>
            {PRESETS.map((preset) => (
              <Button key={preset.label} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setApp((cur) => ({ ...cur, ...preset.sample }))}>
                {preset.label}
              </Button>
            ))}
          </div>
        )}
        {manifest && (
          <div className="space-y-1 rounded-lg border p-3 text-sm">
            <p>Manifest: {manifest.id} · {manifest.version}</p>
            <p>Publisher: {manifest.publisher} (self-declared)</p>
            <p className="text-xs text-muted-foreground">Review this source before connecting. Use a different App ID for each instance.</p>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-name`}>App name</Label>
          <Input
            id={`${prefix}-name`}
            value={app.title}
            placeholder="For example: My Analytics or Local Studio"
            readOnly={Boolean(manifest)}
            maxLength={120}
            required
            onChange={(event) => {
              const title = event.target.value;
              setApp((cur) => ({ ...cur, title, ...(!existing && (!cur.id || cur.id === slugify(cur.title)) ? { id: slugify(title) } : {}) }));
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-id`}>App ID</Label>
          <Input id={`${prefix}-id`} value={app.id} placeholder="my-analytics" readOnly={Boolean(existing)} pattern="[a-z0-9][a-z0-9-]{0,63}" maxLength={64} required onChange={(e) => change("id", e.target.value)} />
          <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only (no spaces).</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-url`}>App address (URL)</Label>
          <Input id={`${prefix}-url`} type="url" value={app.url} placeholder="https://app.yourdomain.com or http://127.0.0.1:8080" maxLength={2048} required onChange={(e) => change("url", e.target.value)} />
          <p className="text-xs text-muted-foreground">Use HTTPS to embed inside MSO, or HTTP (like http://127.0.0.1:8080) to open in a new tab. Never put passwords in the URL.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-description`}>Description</Label>
          <Input id={`${prefix}-description`} value={app.description} placeholder="Short note about what this app does" readOnly={Boolean(manifest)} maxLength={240} onChange={(e) => change("description", e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch aria-label="Embed HTTPS app inside MSO" checked={app.mode === "embed"} onCheckedChange={(checked) => change("mode", checked === true ? "embed" : "tab")} />
          <span className="text-sm">Embed HTTPS app inside MSO</span>
        </div>
        {probe && <p role="status" className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{probe.summary}</p>}
        {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={testing || busy || !app.url.trim()} onClick={() => void testAddress()}>
            {testing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {testing ? "Testing..." : "Test connection"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : existing ? "Save changes" : "Connect app"}</Button>
        </div>
      </form>
    </FormDrawer>
  );
}
