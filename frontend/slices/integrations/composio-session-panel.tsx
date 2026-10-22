"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const SESSION_PATH = "/api/v1/integrations/composio/session";
const EXECUTE_PATH = "/api/v1/integrations";
type KeyKind = "organization" | "user" | "project" | "connect" | null;
type ConnectTool = { name: string; description: string };

/**
 * Connect keys run under the Connect account, so only bounded tool discovery is
 * offered. The credential owner and connection come from the same snapshot the
 * manager uses; the key itself never leaves the server.
 */
async function listConnectTools(): Promise<ConnectTool[]> {
  const query = await fetch("/api/v1/integrations?view=snapshot", { headers: { accept: "application/json" }, cache: "no-store" });
  const snapshot = await query.json().catch(() => ({}));
  if (!query.ok) throw new Error(String(snapshot.error ?? "composio_connect_tools_failed"));
  const connection = (Array.isArray(snapshot.connections) ? snapshot.connections : [])
    .find((row: { provider?: string; id?: string }) => row?.provider === "composio" && typeof row.id === "string");
  if (!snapshot.user || !connection) throw new Error("Configure a Composio connection under this credential owner first.");
  const response = await fetch(EXECUTE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "execute", user: snapshot.user, provider: "composio", connection: connection.id, operation: "composio.tools.list", confirm: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? "composio_connect_tools_failed"));
  return (Array.isArray(body?.tools) ? body.tools as ConnectTool[] : []).filter(tool => typeof tool?.name === "string");
}

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
  const [tools, setTools] = useState<ConnectTool[] | null>(null);

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

  const loadTools = useCallback(async () => {
    setBusy(true);
    setStatus("Listing Composio Connect tools…");
    try {
      setTools(await listConnectTools());
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The Connect tool list could not be loaded.");
    } finally { setBusy(false); }
  }, []);

  if (kind === undefined) return null;
  if (kind === "connect") {
    return (
      <section className="border-b p-3" aria-label="Composio Connect">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">Composio Connect</p>
          <Button variant="secondary" disabled={busy} onClick={() => void loadTools()}>List tools</Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect tools run under the Composio Connect account and cannot create a per-user agent session.
        </p>
        {tools && (
          <ul className="mt-2 text-sm">{tools.map(tool => <li key={tool.name}>{tool.name}</li>)}</ul>
        )}
        {status && <p role="status" className="mt-2 text-sm text-muted-foreground">{status}</p>}
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
