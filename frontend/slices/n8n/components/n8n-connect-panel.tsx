"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import type { RemoteProbeResult } from "@/lib/contracts/remote-connect";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { buildN8nSurfaceApp, extractN8nFormDefaults, formatN8nSurfaceError, suggestedN8nUrl } from "../lib/n8n-url";

export function N8nMark({ className }: { className?: string }) {
  /* eslint-disable-next-line @next/next/no-img-element */
  return <img src="/brand/official/n8n.webp" alt="" aria-hidden className={className ?? "size-10 rounded-xl object-contain"} draggable={false} decoding="async" />;
}

export function N8nConnectPanel({
  existing,
  configurable,
  revision,
  loadMessage,
  onSaved,
  onRefresh,
  onClose,
}: {
  existing: WorkflowEmbed | null;
  configurable: boolean;
  revision: string;
  loadMessage: string;
  onSaved: () => Promise<void>;
  onRefresh: () => void;
  onClose?: () => void;
}) {
  const prefix = useId();
  const initial = extractN8nFormDefaults(existing);
  const [url, setUrl] = useState(initial.url);
  const [authPath, setAuthPath] = useState(initial.authPath);
  const [embed, setEmbed] = useState(initial.embed);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<RemoteProbeResult | null>(null);
  const [error, setError] = useState("");

  const testUrl = async () => {
    const built = buildN8nSurfaceApp({ url, authPath, embed, existing });
    if (!built.ok) { setError(built.error); return; }
    setTesting(true); setError(""); setProbe(null);
    try {
      const res = await fetch("/api/v1/managed-apps/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "https-url", url: url.trim() }),
      });
      const data = (await res.json()) as RemoteProbeResult;
      setProbe(data);
      if (data.recommendation?.embedMode === "remote") setEmbed(false);
    } catch { setError("Could not test this n8n URL."); }
    finally { setTesting(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !configurable) return;
    const built = buildN8nSurfaceApp({ url, authPath, embed, existing });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/workflow-embeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: built.app, expectedRevision: revision, confirm: true }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(formatN8nSurfaceError(payload.error, response.status));
        if (response.status === 409) onRefresh();
        return;
      }
      await onSaved();
    } catch {
      setError("Could not reach MSO to save the n8n connection.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {onClose ? (
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <N8nMark className="size-4 rounded object-contain" />
            <span className="truncate">n8n connection</span>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onRefresh} aria-label="Refresh n8n connection" title="Refresh n8n connection">
            <RefreshCw className="size-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Close n8n settings" title="Close n8n settings">
            <X className="size-3.5" />
          </Button>
        </header>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-6 py-12 text-center">
          <N8nMark className="size-10 rounded-xl object-contain" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold">n8n</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {existing ? "Update the connected n8n instance URL or display mode." : "Connect your n8n instance to open it here."}
            </p>
          </div>

          <div className="w-full space-y-4 text-left">
            {existing?.blocked ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-text">
                {existing.reason || "This n8n origin shares the MSO session cookie. Use a separate cookie-isolated origin."}
              </p>
            ) : null}
            {loadMessage ? (
              <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-text">
                <span>{loadMessage}</span>
                <Button type="button" size="sm" variant="outline" onClick={onRefresh}>Retry</Button>
              </div>
            ) : null}
            {!configurable ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                This n8n connection is managed by deployment configuration.
              </p>
            ) : null}

            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor={`${prefix}-url`} className="text-xs">n8n URL</Label>
                <Input
                  id={`${prefix}-url`}
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={suggestedN8nUrl()}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!configurable || saving}
                  required
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Use an HTTPS address on a separate origin from MSO. Do not include tokens or passwords.
                </p>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="space-y-0.5">
                  <span className="block text-xs font-medium">Embed inside MSO</span>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Renders n8n in an isolated iframe. Turn off to open n8n in a new tab when your instance blocks framing.
                  </p>
                </div>
                <Switch
                  aria-label="Embed inside MSO"
                  checked={embed}
                  disabled={!configurable || saving}
                  onCheckedChange={(checked) => setEmbed(checked === true)}
                />
              </div>

              <details className="rounded-lg border border-border p-2.5" open={Boolean(authPath)}>
                <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                  Sign-in path (optional)
                </summary>
                <div className="mt-2 space-y-1.5">
                  <Label htmlFor={`${prefix}-auth`} className="text-xs">Sign-in path</Label>
                  <Input
                    id={`${prefix}-auth`}
                    type="text"
                    value={authPath}
                    onChange={(event) => setAuthPath(event.target.value)}
                    placeholder="/signin"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!configurable || saving}
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Optional path on the same n8n origin for a direct Sign in link.
                  </p>
                </div>
              </details>

              {probe ? <p role="status" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{probe.summary}</p> : null}
              {error ? <p role="alert" className="text-xs text-destructive-text">{error}</p> : null}

              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" className="w-full" disabled={testing || saving || !url.trim()} onClick={() => void testUrl()}>
                  {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  {testing ? "Testing..." : "Test connection"}
                </Button>
                <Button type="submit" size="lg" className="w-full" disabled={!configurable || saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  {saving ? "Saving…" : existing ? "Save connection" : "Connect n8n"}
                </Button>
                {onClose ? (
                  <Button type="button" variant="ghost" className="w-full" disabled={saving} onClick={onClose}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
