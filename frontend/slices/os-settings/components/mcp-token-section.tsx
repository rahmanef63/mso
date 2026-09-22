"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { KeyRound, Plus, Share2 } from "lucide-react";
import { useState } from "react";
import { McpConnectModal } from "./mcp-connect-modal";

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

const formatTime = (time?: number) => {
  if (time === 0) return "Never (Permanent)";
  return time ? new Date(time).toLocaleString() : "Never";
};

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

  // PAT generation dialog state
  const [patDialogOpen, setPatDialogOpen] = useState(false);
  const [patLabel, setPatLabel] = useState("");
  const [patScope, setPatScope] = useState(maxScope === "read" ? "read" : maxScope === "write" ? "write" : "exec");
  const [patTtl, setPatTtl] = useState<string>("0");
  const [patBusy, setPatBusy] = useState(false);
  const [patError, setPatError] = useState("");

  // Connect modal state
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [activePatToken, setActivePatToken] = useState<string | undefined>(undefined);
  const [activePatLabel, setActivePatLabel] = useState<string | undefined>(undefined);

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
      if (!response.ok) throw new Error("Disconnect failed. Your selection is unchanged; try again.");
      setPending(null);
      onChanged();
    } catch {
      setError("Could not confirm disconnection. Refresh the list to check access before retrying.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGeneratePat(e: React.FormEvent) {
    e.preventDefault();
    const label = patLabel.trim();
    if (!label) {
      setPatError("Please enter a name for this token.");
      return;
    }
    setPatBusy(true);
    setPatError("");
    try {
      const response = await fetch("/api/mcp/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          scope: patScope,
          ttlDays: Number(patTtl) || 0,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to generate token");
      }
      setPatDialogOpen(false);
      setPatLabel("");
      onChanged();
      // Show newly minted token in connect modal
      setActivePatToken(data.token);
      setActivePatLabel(label);
      setConnectModalOpen(true);
    } catch (err: unknown) {
      setPatError(err instanceof Error ? err.message : "Failed to generate token");
    } finally {
      setPatBusy(false);
    }
  }

  function handleOpenConnect(label?: string) {
    setActivePatToken(undefined);
    setActivePatLabel(label);
    setConnectModalOpen(true);
  }

  const allowedScopes = ["read"];
  if (maxScope === "write" || maxScope === "exec") allowedScopes.push("write");
  if (maxScope === "exec") allowedScopes.push("exec");

  return (
    <SettingsSection
      icon={<KeyRound />}
      title="Connected apps & tokens"
      footnote="Disconnecting revokes the access token immediately. The app must reconnect to regain access."
    >
      <SettingsBlock className="flex flex-wrap items-center justify-between gap-3 py-3">
        <p className="text-sm">
          {active.length} active connection{active.length === 1 ? "" : "s"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setPatDialogOpen(true)}
            className="min-h-11"
          >
            <Plus className="mr-1.5 size-4" />
            Generate New Token (PAT)
          </Button>
          <Button onClick={onConnect} className="min-h-11">
            Connect an app
          </Button>
        </div>
      </SettingsBlock>

      {/* PAT Creation Dialog */}
      <Dialog open={patDialogOpen} onOpenChange={setPatDialogOpen}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader className="space-y-1">
            <DialogTitle>Generate Personal Access Token (PAT)</DialogTitle>
            <DialogDescription>
              Create a long-lived or permanent token for Gemini CLI, Antigravity, Cursor, or scripts.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleGeneratePat} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="pat-label" className="text-sm font-medium">
                Token Name / Description
              </label>
              <input
                id="pat-label"
                type="text"
                placeholder="e.g. Gemini CLI, Antigravity, Cursor"
                value={patLabel}
                onChange={(e) => setPatLabel(e.target.value)}
                maxLength={80}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pat-ttl" className="text-sm font-medium">
                Expiration / Masa Aktif
              </label>
              <select
                id="pat-ttl"
                value={patTtl}
                onChange={(e) => setPatTtl(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="0">Never expires (Permanent)</option>
                <option value="90">90 Days</option>
                <option value="30">30 Days</option>
                <option value="7">7 Days</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pat-scope" className="text-sm font-medium">
                Access Scope
              </label>
              <select
                id="pat-scope"
                value={patScope}
                onChange={(e) => setPatScope(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              >
                {allowedScopes.includes("read") && (
                  <option value="read">Read (Read-only data access)</option>
                )}
                {allowedScopes.includes("write") && (
                  <option value="write">Write (Read + change data, manage apps)</option>
                )}
                {allowedScopes.includes("exec") && (
                  <option value="exec">Exec (Full host commands &amp; workflows)</option>
                )}
              </select>
            </div>

            {patError && (
              <p role="alert" className="text-sm text-destructive">
                {patError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                disabled={patBusy}
                onClick={() => setPatDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={patBusy}>
                {patBusy ? "Generating…" : "Generate Token"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation */}
      {pending && (
        <SettingsBlock className="space-y-3 border border-destructive/30 py-4">
          <p className="text-sm font-medium">Disconnect {pending.label}?</p>
          <p className="text-sm text-muted-foreground">
            Requests using this access will stop working immediately.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void disconnect()}
              className="min-h-11"
            >
              {busy ? "Disconnecting…" : "Confirm disconnect"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setError("");
              }}
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
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    Never expires
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {permissions[token.scope] ?? token.scope} · {token.status}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {token.status === "active" && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenConnect(token.label)}
                    className="min-h-9"
                    title="View setup guides"
                  >
                    <Share2 className="mr-1.5 size-3.5" />
                    Connect to AI
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPending({ id: token.id, label: token.label });
                      setError("");
                    }}
                    className="min-h-9"
                  >
                    Disconnect
                    <span className="sr-only"> {token.label}</span>
                  </Button>
                </>
              )}
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Last used {formatTime(token.lastUsedAt)}
            <br />
            Expires {formatTime(token.expiresAt)}
          </p>
          <details>
            <summary className="cursor-pointer py-2 text-sm text-muted-foreground">
              Client details
            </summary>
            <p className="break-all font-mono text-xs">{token.clientId}</p>
          </details>
        </SettingsBlock>
      ))}

      <div className="flex flex-wrap gap-2">
        {tokens.length > active.length && (
          <Button
            variant="ghost"
            aria-pressed={showInactive}
            onClick={() => setShowInactive((value) => !value)}
            className="min-h-11"
          >
            {showInactive ? "Hide" : "Show"} expired &amp; disconnected
          </Button>
        )}
        {active.length > 1 && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              setPending({
                id: "all",
                label: `all ${active.length} active connections`,
              })
            }
            className="min-h-11 text-destructive"
          >
            Disconnect all
          </Button>
        )}
      </div>

      {/* Connect to AI Modal */}
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
