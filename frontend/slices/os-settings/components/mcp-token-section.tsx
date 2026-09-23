"use client";

import { Button } from "@/components/ui/button";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { KeyRound, Plus, Share2 } from "lucide-react";
import { useState } from "react";
import { McpConnectModal } from "./mcp-connect-modal";
import { McpPatDialog } from "./mcp-pat-dialog";

export type McpTokenRow = {
  id: string;
  label: string;
  clientId: string;
  scope: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  status: "active" | "revoked" | "expired";
};

const formatTime = (time?: number) => time === 0 ? "Never (Permanent)" : time ? new Date(time).toLocaleString() : "Never";
const permissions: Record<string, string> = {
  read: "Read data",
  write: "Read and change data",
  exec: "Run host commands",
};

export function McpTokenSection({
  tokens,
  origin = "",
  maxScope = "exec",
  onChanged,
  onConnect,
}: {
  tokens: McpTokenRow[];
  origin?: string;
  maxScope?: string;
  onChanged: () => void;
  onConnect: () => void;
}) {
  const [pending, setPending] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [patDialogOpen, setPatDialogOpen] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [activePatToken, setActivePatToken] = useState<string>();
  const [activePatLabel, setActivePatLabel] = useState<string>();
  const effectiveOrigin = origin || (typeof window !== "undefined" ? window.location.origin : "");
  const active = tokens.filter((token) => token.status === "active");
  const visible = showInactive ? tokens : active;

  async function disconnect() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/mcp/tokens?id=${encodeURIComponent(pending.id)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Disconnect failed");
      setPending(null);
      onChanged();
    } catch {
      setError("Could not confirm disconnection. Refresh the list to check access before retrying.");
    } finally {
      setBusy(false);
    }
  }

  function openConnect(label?: string) {
    setActivePatToken(undefined);
    setActivePatLabel(label);
    setConnectModalOpen(true);
  }

  return (
    <SettingsSection
      icon={<KeyRound />}
      title="Connected apps & tokens"
      footnote="Disconnecting revokes the access token immediately. The app must reconnect to regain access."
    >
      <SettingsBlock className="flex flex-wrap items-center justify-between gap-3 py-3">
        <p className="text-sm">{active.length} active connection{active.length === 1 ? "" : "s"}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPatDialogOpen(true)} className="min-h-11">
            <Plus className="mr-1.5 size-4" />
            Generate New Token (PAT)
          </Button>
          <Button onClick={onConnect} className="min-h-11">Connect an app</Button>
        </div>
      </SettingsBlock>

      {pending && (
        <SettingsBlock className="space-y-3 border border-destructive/30 py-4">
          <p className="text-sm font-medium">Disconnect {pending.label}?</p>
          <p className="text-sm text-muted-foreground">Requests using this access will stop working immediately.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" disabled={busy} onClick={() => void disconnect()} className="min-h-11">
              {busy ? "Disconnecting…" : "Confirm disconnect"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => { setPending(null); setError(""); }}
              className="min-h-11"
            >
              Cancel
            </Button>
          </div>
        </SettingsBlock>
      )}

      {visible.length === 0 && (
        <SettingsBlock className="py-4">
          <p className="text-sm text-muted-foreground">
            No active connections. Choose “Generate New Token (PAT)” or “Connect an app” to get started.
          </p>
        </SettingsBlock>
      )}

      {visible.map((token) => (
        <SettingsBlock key={token.id} className="space-y-3 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="break-words text-sm font-medium">{token.label}</h3>
                {token.expiresAt === 0 && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">Never expires</span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{permissions[token.scope] ?? token.scope} · {token.status}</p>
            </div>
            {token.status === "active" && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => openConnect(token.label)} className="min-h-9" title="View setup guides">
                  <Share2 className="mr-1.5 size-3.5" />
                  Connect to AI
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => { setPending({ id: token.id, label: token.label }); setError(""); }}
                  className="min-h-9"
                >
                  Disconnect<span className="sr-only"> {token.label}</span>
                </Button>
              </div>
            )}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Last used {formatTime(token.lastUsedAt)}<br />Expires {formatTime(token.expiresAt)}
          </p>
          <details>
            <summary className="cursor-pointer py-2 text-sm text-muted-foreground">Client details</summary>
            <p className="break-all font-mono text-xs">{token.clientId}</p>
          </details>
        </SettingsBlock>
      ))}

      <div className="flex flex-wrap gap-2">
        {tokens.length > active.length && (
          <Button variant="ghost" aria-pressed={showInactive} onClick={() => setShowInactive((value) => !value)} className="min-h-11">
            {showInactive ? "Hide" : "Show"} expired &amp; disconnected
          </Button>
        )}
        {active.length > 1 && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setPending({ id: "all", label: `all ${active.length} active connections` })}
            className="min-h-11 text-destructive"
          >
            Disconnect all
          </Button>
        )}
      </div>

      <McpPatDialog
        open={patDialogOpen}
        maxScope={maxScope}
        onOpenChange={setPatDialogOpen}
        onMinted={(token, label) => {
          onChanged();
          setActivePatToken(token);
          setActivePatLabel(label);
          setConnectModalOpen(true);
        }}
      />
      <McpConnectModal
        open={connectModalOpen}
        onOpenChange={setConnectModalOpen}
        origin={effectiveOrigin}
        token={activePatToken}
        label={activePatLabel}
      />
    </SettingsSection>
  );
}
