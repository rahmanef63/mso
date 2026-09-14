"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openWindow } from "@/features/appshell";

type Receipt = { revision?: string; configured: boolean };

/** Uses the existing owner-only project binding API; registration is not a health check. */
export function McpPluginRuntime({ plugin, project, endpoint }: { plugin: string; project: string; endpoint?: string }) {
  const [receipt, setReceipt] = useState<Receipt>({ configured: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Not inspected for this project.");
  const [user, setUser] = useState("");
  const [connection, setConnection] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  async function run(action: "inspect" | "upsert" | "delete") {
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller;
    setBusy(true);
    try {
      const args = { project, server: plugin, action, ...(action !== "inspect" ? { revision: receipt.revision } : {}),
        ...(action === "upsert" ? plugin === "si-coder" ? { plugin: "si-coder" } : { url: endpoint, user, connection } : {}) };
      const response = await fetch("/api/v1/project-mcp", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Plugin operation failed");
      const configured = action === "inspect" ? data.servers?.some((server: { name: string }) => server.name === plugin) === true : action === "upsert";
      setReceipt({ revision: data.revision, configured });
      setMessage(configured ? "Project binding configured. Tool discovery and execution have not been verified by this panel." : "Declared only; no binding in this project.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Plugin operation failed");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="mt-3 space-y-3 border-t pt-3">
    <p role="status" className="break-words text-xs font-medium">{busy ? "Checking project binding…" : message}</p>
    <p className="text-xs text-muted-foreground">{plugin === "si-coder"
      ? "Managed mode uses MSO accounts and connection verification. Standalone SC is unchanged. Provider writes use native Integrations."
      : "Batonly owns project plans, tasks, and evidence. Bind an exact private MCP connection from MSO Integrations."}</p>
    {plugin === "batonly" && <div className="grid gap-2">
      <Input aria-label="Batonly connection owner" placeholder="MSO connection owner" value={user} disabled={busy} onChange={event => setUser(event.target.value)} />
      <Input aria-label="Batonly named MCP connection" placeholder="Named MCP connection, not a token" value={connection} disabled={busy} onChange={event => setConnection(event.target.value)} />
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" disabled={busy || !project.trim()} onClick={() => void run("inspect")}>Inspect binding</Button>
      <Button size="sm" disabled={busy || !receipt.revision || (plugin === "batonly" && (!user || !connection))}
        onClick={() => { if (!receipt.configured || window.confirm("Replace this project's existing plugin binding?")) void run("upsert"); }}>{receipt.configured ? "Replace binding" : "Activate in project"}</Button>
      {receipt.configured && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { if (window.confirm("Remove only this project's binding? Other projects and remote accounts are unchanged.")) void run("delete"); }}>Deactivate</Button>}
      <Button variant="ghost" size="sm" onClick={() => openWindow("integrations", "Integrations")}>Open Integrations</Button>
    </div>
    {receipt.configured && <p className="text-xs text-muted-foreground">Verify through MSO with <code>project_mcp_tools</code> for this project and server <code>{plugin}</code>{plugin === "si-coder" ? ", then project_mcp_call → sc.version." : ". Discovery is not proof of every remote operation."}</p>}
  </div>;
}
