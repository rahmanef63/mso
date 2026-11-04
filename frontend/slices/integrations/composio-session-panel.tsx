"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const SESSION_PATH = "/api/v1/integrations/composio/session";
type KeyKind = "organization" | "user" | "project" | "connect" | null;
type Connection = { id: string; label: string; provider: string; source: string };
type ConnectTool = { name: string };

export function ComposioSessionPanel({ owner }: { owner: string | null }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connection, setConnection] = useState("");
  const [kind, setKind] = useState<KeyKind | undefined>();
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    fetch(`/api/v1/integrations?view=snapshot&user=${encodeURIComponent(owner)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (controller.signal.aborted) return;
        setConnections((body.connections as Connection[]).filter(row => row.provider === "composio" && row.source === "direct"));
      }).catch(() => { if (!controller.signal.aborted) setStatus("Could not load Composio connections."); });
    return () => controller.abort();
  }, [owner]);

  useEffect(() => {
    if (!owner || !connection) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ user: owner, connection });
    fetch(`${SESSION_PATH}?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) setKind(body.keyKind ?? null);
      }).catch(() => { if (!controller.signal.aborted) setStatus("Could not inspect this connection."); });
    return () => controller.abort();
  }, [owner, connection]);

  // Changing either selection unmounts the operation component and aborts its request.
  if (!owner || (!connections.length && !status)) return null;
  return <details className="max-h-[40%] shrink-0 overflow-auto border-b p-[var(--feature-padding,.75rem)]" aria-label="Composio">
    <summary className="cursor-pointer text-sm">Composio tools and session</summary>
    <label className="mt-2 block text-sm">Connection for {owner}
      <select className="mt-1 block min-h-11 w-full rounded border bg-background p-2" value={connection} onChange={event => { setKind(undefined); setStatus(""); setConnection(event.target.value); }}>
        <option value="">Choose a connection</option>
        {connections.map(row => <option key={row.id} value={row.id}>{row.label} ({row.id})</option>)}
      </select>
    </label>
    {connection && kind === null && <p className="mt-2 text-sm text-muted-foreground">No Composio key is configured for this connection.</p>}
    {owner && connection && kind && <SessionActions key={owner + ":" + connection} owner={owner} connection={connection} kind={kind} />}
    {status && <p role="status" className="mt-2 text-sm text-muted-foreground">{status}</p>}
  </details>;
}

function SessionActions({ owner, connection, kind }: { owner: string; connection: string; kind: Exclude<KeyKind, null> }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("");
  const [tools, setTools] = useState<ConnectTool[] | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(refresh = false) {
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setStatus(kind === "connect" ? "Listing tools..." : "Creating the agent session...");
    try {
      const response = await fetch(kind === "connect" ? "/api/v1/integrations" : SESSION_PATH, {
        method: "POST", headers: { "content-type": "application/json" }, signal: request.signal,
        body: JSON.stringify(kind === "connect"
          ? { mode: "execute", user: owner, provider: "composio", connection, operation: "composio.tools.list", confirm: true }
          : { user: owner, connection, refresh }),
      });
      const body = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok) throw new Error(String(body.error ?? "Request failed."));
      if (kind === "connect") setTools(Array.isArray(body.tools) ? body.tools.filter((tool: ConnectTool) => typeof tool?.name === "string") : []);
      else if (typeof body.mcpUrl === "string") setMcpUrl(body.mcpUrl);
      else throw new Error("The session could not be created.");
      setStatus(kind === "connect" ? "" : "Agent session ready.");
    } catch (error) {
      if (!request.signal.aborted) setStatus(error instanceof Error ? error.message : "Request failed.");
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="mt-2">
    <Button variant="secondary" disabled={busy} onClick={() => void run()}>{kind === "connect" ? "List tools" : "Create agent session"}</Button>
    {mcpUrl && <Button variant="ghost" disabled={busy} onClick={() => void run(true)}>Refresh session</Button>}
    <p className="mt-2 text-sm text-muted-foreground">{kind === "connect" ? "Connect tools run under this connection's account." : "Tools run as this credential owner. The session credential stays on the MSO server."}</p>
    {mcpUrl && <label className="mt-2 block text-sm">Hosted MCP endpoint<input readOnly value={mcpUrl} className="mt-1 w-full rounded border bg-background p-2 font-mono text-xs" onFocus={event => event.currentTarget.select()} /></label>}
    {tools && (tools.length ? <ul className="mt-2 break-words text-sm">{tools.map(tool => <li key={tool.name}>{tool.name}</li>)}</ul> : <p className="mt-2 text-sm">No tools returned.</p>)}
    {status && <p role="status" className="mt-2 text-sm text-muted-foreground">{status}</p>}
  </div>;
}
