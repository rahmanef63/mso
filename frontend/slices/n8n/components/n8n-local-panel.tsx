"use client";

import { useId, useState } from "react";
import { CheckCircle2, ExternalLink, FolderSearch, Loader2, AlertTriangle } from "lucide-react";
import type { DiscoveredLocalApp } from "@/lib/contracts/app-discovery";
import type { RemoteProbeResult } from "@/lib/contracts/remote-connect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function N8nLocalPanel({
  detected,
  onOpenManaged,
}: {
  detected: DiscoveredLocalApp | null;
  onOpenManaged: () => void;
}) {
  const prefix = useId();
  const [endpoint, setEndpoint] = useState(detected?.detectedEndpoint ?? "http://127.0.0.1:5678");
  const [dataDir, setDataDir] = useState(detected?.detectedPath ?? "~/.n8n");
  const [probe, setProbe] = useState<RemoteProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const testLocal = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/managed-apps/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "local-existing",
          endpoint,
          dataDir: dataDir.trim() || undefined,
        }),
      });
      const data = (await res.json()) as RemoteProbeResult & { error?: string };
      if (!res.ok) setError(data.error ?? "Could not inspect local n8n.");
      else setProbe(data);
    } catch {
      setError("Could not reach MSO to inspect local n8n.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 text-left">
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1.5">
        <p className="font-medium text-foreground">Install or control n8n with MSO</p>
        <p className="text-muted-foreground">
          {detected?.hint ?? "MSO can install official Docker n8n on loopback port 5678 and manage start, stop, updates, backups, and uninstall while keeping ~/.n8n data safe."}
        </p>
        <Button type="button" size="sm" onClick={onOpenManaged}>
          {detected?.ownership === "mso-managed" ? "Open MSO n8n controls" : "Install n8n with MSO"}
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="space-y-0.5">
          <h4 className="text-xs font-semibold">Already have n8n on this computer?</h4>
          <p className="text-[11px] text-muted-foreground">
            Check your existing local address and data folder before connecting. MSO will not overwrite or remove an app you installed manually.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-endpoint`} className="text-xs">Local n8n address</Label>
          <Input
            id={`${prefix}-endpoint`}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://127.0.0.1:5678"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">Default n8n port is 5678. Use http://127.0.0.1:5678 or your custom local port.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-dir`} className="text-xs">n8n data folder (optional)</Label>
          <Input
            id={`${prefix}-dir`}
            value={dataDir}
            onChange={(e) => setDataDir(e.target.value)}
            placeholder="~/.n8n (contains database.sqlite and config)"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">Must be inside your home folder, for example ~/.n8n.</p>
        </div>

        {error && <p role="alert" className="text-xs text-destructive-text">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy || !endpoint.trim()} onClick={() => void testLocal()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FolderSearch className="size-3.5" aria-hidden />}
            Check local n8n
          </Button>
          {probe?.ok && probe.recommendation?.suggestedUrl && (
            <Button asChild size="sm">
              <a href={probe.recommendation.suggestedUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" aria-hidden /> Open in new tab
              </a>
            </Button>
          )}
        </div>

        {probe && (
          <div className="rounded-md border border-border bg-muted/20 p-2.5 text-xs space-y-1.5">
            <p className="font-medium flex items-center gap-1.5">
              {probe.ok ? <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden /> : <AlertTriangle className="size-3.5 text-amber-500" aria-hidden />}
              {probe.summary}
            </p>
            <ul className="space-y-1 text-muted-foreground">
              {probe.checks.map((c) => (
                <li key={c.label}><strong>{c.label}:</strong> {c.detail}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
