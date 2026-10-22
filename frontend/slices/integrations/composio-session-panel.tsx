"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const SESSION_PATH = "/api/v1/integrations/composio/session";
type KeyKind = "organization" | "user" | "project" | "connect" | null;

/**
 * Composio agent session, shown for a Platform key only. The session credential
 * (`mcp.headers`) never leaves the server: only the MCP URL is displayed, and it is
 * the URL of the session belonging to this signed-in credential owner.
 */
export function ComposioSessionPanel() {
  const [kind, setKind] = useState<KeyKind | undefined>(undefined);
  const [mcpUrl, setMcpUrl] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(SESSION_PATH, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(response => response.ok ? response.json() : { keyKind: null })
      .then((body: { keyKind?: KeyKind }) => { if (live) setKind(body.keyKind ?? null); })
      .catch(() => { if (live) setKind(null); });
    return () => { live = false; };
  }, []);

  const create = useCallback(async (refresh: boolean) => {
    setBusy(true);
    setStatus("Creating the agent session…");
    try {
      const response = await fetch(SESSION_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(refresh ? { refresh: true } : {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.mcpUrl !== "string") {
        setStatus(String(body.error ?? "The session could not be created."));
        return;
      }
      setMcpUrl(body.mcpUrl);
      setStatus(refresh ? "Fresh agent session created." : "Agent session ready.");
    } catch {
      setStatus("The session could not be created.");
    } finally { setBusy(false); }
  }, []);

  if (kind === undefined) return null;
  if (kind === "connect") {
    return (
      <section className="border-b p-3" aria-label="Composio Connect key">
        <p className="text-sm text-muted-foreground">
          This is a Composio Connect consumer key (ck_…). It belongs to Project MCP with the endpoint
          https://connect.composio.dev/mcp, and cannot create a per-user agent session.
        </p>
      </section>
    );
  }
  if (kind === null) return null;

  return (
    <section className="border-b p-3" aria-label="Composio agent session">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => void create(false)}>Create agent session</Button>
        {mcpUrl && <Button variant="ghost" disabled={busy} onClick={() => void create(true)}>Refresh session</Button>}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Tools run as this credential owner. The session credential stays on the MSO server.
      </p>
      {mcpUrl && (
        <label className="mt-2 block text-sm">
          Hosted MCP endpoint
          <input readOnly value={mcpUrl} className="mt-1 w-full rounded border bg-background p-2 font-mono text-xs" onFocus={event => event.currentTarget.select()} />
        </label>
      )}
      {status && <p role="status" className="mt-2 text-sm text-muted-foreground">{status}</p>}
    </section>
  );
}
