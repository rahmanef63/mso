"use client";

import { Button } from "@/components/ui/button";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { KeyRound } from "lucide-react";
import { useState } from "react";

export type McpTokenRow = {
  id: string; label: string; clientId: string; scope: string; createdAt: number;
  expiresAt: number; lastUsedAt?: number; status: "active" | "revoked" | "expired";
};
const formatTime = (time?: number) => time ? new Date(time).toLocaleString() : "Never";
const permissions: Record<string, string> = { read: "Read data", write: "Read and change data", exec: "Run host commands" };

export function McpTokenSection({ tokens, onChanged, onConnect }: { tokens: McpTokenRow[]; onChanged: () => void; onConnect: () => void }) {
  const [pending, setPending] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const active = tokens.filter(token => token.status === "active");
  const visible = showInactive ? tokens : active;
  async function disconnect() {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/mcp/tokens?id=${encodeURIComponent(pending.id)}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Disconnect failed. Your selection is unchanged; try again.");
      setPending(null); onChanged();
    } catch { setError("Could not confirm disconnection. Refresh the list to check access before retrying."); }
    finally { setBusy(false); }
  }
  return <SettingsSection icon={<KeyRound />} title="Connected apps" footnote="Disconnecting revokes the access token immediately. The app must reconnect to regain access.">
    <SettingsBlock className="flex flex-wrap items-center justify-between gap-3 py-3">
      <p className="text-sm">{active.length} active connection{active.length === 1 ? "" : "s"}</p>
      <Button onClick={onConnect} className="min-h-11">Connect an app</Button>
    </SettingsBlock>
    {pending && <SettingsBlock className="space-y-3 border border-destructive/30 py-4">
      <p className="text-sm font-medium">Disconnect {pending.label}?</p>
      <p className="text-sm text-muted-foreground">Requests using this access will stop working immediately.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={busy} onClick={() => void disconnect()} className="min-h-11">{busy ? "Disconnecting…" : "Confirm disconnect"}</Button><Button variant="secondary" disabled={busy} onClick={() => { setPending(null); setError(""); }} className="min-h-11">Cancel</Button></div>
    </SettingsBlock>}
    {visible.length === 0 && <SettingsBlock className="py-4"><p className="text-sm text-muted-foreground">No active connections. Choose “Connect an app” to get started.</p></SettingsBlock>}
    {visible.map(token => <SettingsBlock key={token.id} className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-medium">{token.label}</h3><p className="mt-1 text-sm text-muted-foreground">{permissions[token.scope] ?? token.scope} · {token.status}</p></div>
        {token.status === "active" && <Button variant="outline" disabled={busy} onClick={() => { setPending({ id: token.id, label: token.label }); setError(""); }} className="min-h-11">Disconnect<span className="sr-only"> {token.label}</span></Button>}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">Last used {formatTime(token.lastUsedAt)}<br />Expires {formatTime(token.expiresAt)}</p>
      <details><summary className="cursor-pointer py-2 text-sm text-muted-foreground">Client details</summary><p className="break-all font-mono text-xs">{token.clientId}</p></details>
    </SettingsBlock>)}
    <div className="flex flex-wrap gap-2">
      {tokens.length > active.length && <Button variant="ghost" aria-pressed={showInactive} onClick={() => setShowInactive(value => !value)} className="min-h-11">{showInactive ? "Hide" : "Show"} expired &amp; disconnected</Button>}
      {active.length > 1 && <Button variant="ghost" disabled={busy} onClick={() => setPending({ id: "all", label: `all ${active.length} active connections` })} className="min-h-11 text-destructive">Disconnect all</Button>}
    </div>
  </SettingsSection>;
}
