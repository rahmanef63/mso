"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Play, Square, Terminal, Trash2 } from "lucide-react";
import type { RemoteProbeResult, SshTunnelSnapshot, SshTunnelView } from "@/lib/contracts/remote-connect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, data };
}

export function N8nSshPanel({ appId = "n8n", defaultRemotePort = 5678, defaultLocalPort = 15678 }: {
  appId?: string;
  defaultRemotePort?: number;
  defaultLocalPort?: number;
}) {
  const prefix = useId();
  const [sshUser, setSshUser] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [remotePort, setRemotePort] = useState(String(defaultRemotePort));
  const [localPort, setLocalPort] = useState(String(defaultLocalPort));
  const [identityFile, setIdentityFile] = useState("~/.ssh/id_ed25519");
  const [probe, setProbe] = useState<RemoteProbeResult | null>(null);
  const [tunnels, setTunnels] = useState<SshTunnelView[]>([]);
  const [sshAvailable, setSshAvailable] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadTunnels = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/managed-apps/tunnels", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as SshTunnelSnapshot;
      setSshAvailable(data.sshAvailable);
      setTunnels(data.tunnels.filter((t) => t.appId === appId));
    } catch { /* optional panel */ }
  }, [appId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void loadTunnels(); });
    return () => cancelAnimationFrame(frame);
  }, [loadTunnels]);

  const common = () => ({
    sshUser,
    sshHost,
    sshPort: Number(sshPort) || 22,
    remotePort: Number(remotePort) || defaultRemotePort,
    localPort: Number(localPort) || defaultLocalPort,
    identityFile: identityFile.trim() || undefined,
  });

  const runProbe = async () => {
    setBusy("probe"); setError("");
    try {
      const { ok, data } = await postJson<RemoteProbeResult & { error?: string }>("/api/v1/managed-apps/probe", {
        mode: "ssh-tunnel", ...common(), testSsh: true,
      });
      if (!ok) setError(data.error ?? "Could not test SSH settings.");
      else setProbe(data);
    } catch { setError("Could not reach MSO to test the SSH connection."); }
    finally { setBusy(null); }
  };

  const saveAndStart = async () => {
    setBusy("save"); setError("");
    try {
      const id = `${appId}-ssh-${localPort}`;
      const saved = await postJson<{ error?: string }>("/api/v1/managed-apps/tunnels", {
        action: "save", id, appId, title: `${appId} on ${sshHost.trim()}`, ...common(),
      });
      if (!saved.ok) { setError(saved.data.error ?? "Could not save SSH tunnel."); return; }
      const started = await postJson<{ error?: string }>("/api/v1/managed-apps/tunnels", { action: "start", id });
      if (!started.ok) setError(started.data.error ?? "Tunnel saved, but could not start.");
      await loadTunnels();
    } catch { setError("Could not reach MSO to start the SSH tunnel."); }
    finally { setBusy(null); }
  };

  const tunnelAction = async (action: "start" | "stop" | "delete", id: string) => {
    setBusy(`${action}:${id}`); setError("");
    try {
      const res = await postJson<{ error?: string }>("/api/v1/managed-apps/tunnels", { action, id });
      if (!res.ok) setError(res.data.error ?? "Tunnel action failed.");
      await loadTunnels();
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4 text-left">
      <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <KeyRound className="size-3.5" aria-hidden /> What you need for SSH connect
        </p>
        <p>1. Your remote server username and IP/hostname (for example <code className="font-mono text-[11px]">ubuntu</code> and <code className="font-mono text-[11px]">192.168.1.50</code>).</p>
        <p>2. A private SSH key inside <code className="font-mono text-[11px]">~/.ssh/</code> (example: <code className="font-mono text-[11px]">~/.ssh/id_ed25519</code> with mode 600). Passwords are never saved.</p>
      </div>

      {!sshAvailable && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-text">
          OpenSSH client (ssh) is not installed on this host.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-user`} className="text-xs">Server username</Label>
          <Input id={`${prefix}-user`} value={sshUser} onChange={(e) => setSshUser(e.target.value)} placeholder="ubuntu or root" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-host`} className="text-xs">Server IP or hostname</Label>
          <Input id={`${prefix}-host`} value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="192.168.1.50 or vps.example.com" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-rport`} className="text-xs">Remote n8n port</Label>
          <Input id={`${prefix}-rport`} type="number" value={remotePort} onChange={(e) => setRemotePort(e.target.value)} placeholder="5678" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-lport`} className="text-xs">Local tunnel port</Label>
          <Input id={`${prefix}-lport`} type="number" value={localPort} onChange={(e) => setLocalPort(e.target.value)} placeholder="15678" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-sport`} className="text-xs">SSH port</Label>
          <Input id={`${prefix}-sport`} type="number" value={sshPort} onChange={(e) => setSshPort(e.target.value)} placeholder="22" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-key`} className="text-xs">SSH key file (inside ~/.ssh)</Label>
          <Input id={`${prefix}-key`} value={identityFile} onChange={(e) => setIdentityFile(e.target.value)} placeholder="~/.ssh/id_ed25519" />
        </div>
      </div>

      {error && <p role="alert" className="text-xs text-destructive-text">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy !== null || !sshUser || !sshHost} onClick={() => void runProbe()}>
          {busy === "probe" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Terminal className="size-3.5" aria-hidden />}
          Test SSH connection
        </Button>
        <Button type="button" size="sm" disabled={busy !== null || !sshAvailable || !sshUser || !sshHost} onClick={() => void saveAndStart()}>
          {busy === "save" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          Save and start tunnel
        </Button>
      </div>

      {probe && (
        <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
          <p className="flex items-center gap-1.5 font-medium">
            {probe.ok ? <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden /> : <AlertTriangle className="size-3.5 text-amber-500" aria-hidden />}
            {probe.summary}
          </p>
          <ul className="space-y-1 text-muted-foreground">
            {probe.checks.map((c) => <li key={c.label}><strong>{c.label}:</strong> {c.detail}</li>)}
          </ul>
          {probe.recommendation?.tunnelCommand && (
            <code className="block overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px]">{probe.recommendation.tunnelCommand}</code>
          )}
        </div>
      )}

      {tunnels.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Saved SSH tunnels</h4>
          {tunnels.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-xs">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.title} ({t.active ? "Running" : "Stopped"})</p>
                <p className="font-mono text-[11px] text-muted-foreground">{t.localUrl} -&gt; {t.sshUser}@{t.sshHost}:{t.remotePort}</p>
                {t.error && <p className="text-destructive-text">{t.error}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                {t.active ? (
                  <>
                    <Button asChild size="sm" variant="outline"><a href={t.localUrl} target="_blank" rel="noopener noreferrer">Open</a></Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void tunnelAction("stop", t.id)}><Square className="size-3.5" aria-hidden /></Button>
                  </>
                ) : (
                  <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void tunnelAction("start", t.id)}><Play className="size-3.5" aria-hidden />Start</Button>
                )}
                <Button type="button" size="icon" variant="ghost" aria-label={`Delete tunnel ${t.title}`} disabled={busy !== null} onClick={() => void tunnelAction("delete", t.id)}><Trash2 className="size-3.5" aria-hidden /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
