"use client";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/features/appshell";
import { useState } from "react";

export function McpPatDialog({
  open,
  maxScope,
  onOpenChange,
  onMinted,
}: {
  open: boolean;
  maxScope: string;
  onOpenChange: (open: boolean) => void;
  onMinted: (token: string, label: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState(maxScope === "read" ? "read" : maxScope === "write" ? "write" : "exec");
  const [ttl, setTtl] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const allowedScopes = ["read"];
  if (maxScope === "write" || maxScope === "exec") allowedScopes.push("write");
  if (maxScope === "exec") allowedScopes.push("exec");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setError("Please enter a name for this token.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mcp/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: cleanLabel, scope, ttlDays: Number(ttl) || 0 }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Failed to generate token");
      setLabel("");
      onOpenChange(false);
      onMinted(data.token, cleanLabel);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to generate token");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} size="md" mobileVariant="drawer-bottom">
      <ResponsiveDialog.Header>
        <ResponsiveDialog.Title>Generate Personal Access Token (PAT)</ResponsiveDialog.Title>
        <ResponsiveDialog.Description>
          Create a long-lived or permanent token for Gemini CLI, Antigravity, Cursor, or scripts.
        </ResponsiveDialog.Description>
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Body>
        <form id="mcp-pat-form" onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="pat-label" className="text-sm font-medium">Token Name / Description</label>
            <input
              id="pat-label"
              type="text"
              placeholder="e.g. Gemini CLI, Antigravity, Cursor"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={80}
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pat-ttl" className="text-sm font-medium">Expiration / Masa Aktif</label>
            <select
              id="pat-ttl"
              value={ttl}
              onChange={(event) => setTtl(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="0">Never expires (Permanent)</option>
              <option value="90">90 Days</option>
              <option value="30">30 Days</option>
              <option value="7">7 Days</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pat-scope" className="text-sm font-medium">Access Scope</label>
            <select
              id="pat-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            >
              {allowedScopes.includes("read") && <option value="read">Read (Read-only data access)</option>}
              {allowedScopes.includes("write") && <option value="write">Write (Read + change data, manage apps)</option>}
              {allowedScopes.includes("exec") && <option value="exec">Exec (Full host commands &amp; workflows)</option>}
            </select>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </ResponsiveDialog.Body>
      <ResponsiveDialog.Footer>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="submit" form="mcp-pat-form" disabled={busy}>{busy ? "Generating…" : "Generate Token"}</Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
