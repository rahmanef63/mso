"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openWindow } from "@/features/appshell";

type Receipt = { revision?: string; installed: boolean };

/** Uses the existing owner-only project binding API; registration is not a health check. */
export function McpPluginRuntime({ plugin, project }: { plugin: string; project: string }) {
  const [receipt, setReceipt] = useState<Receipt>({ installed: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Available in the catalog. Choose a project, then check installation.");
  const [user, setUser] = useState("");
  const [connection, setConnection] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  async function run(action: "inspect" | "upsert" | "delete") {
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller;
    setBusy(true);
    try {
      const args = { project, server: plugin, action, ...(action !== "inspect" ? { revision: receipt.revision } : {}),
        ...(action === "upsert" ? plugin === "si-coder" ? { plugin: "si-coder" } : { plugin: "batonly", user, connection } : {}) };
      const response = await fetch("/api/v1/project-mcp", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Plugin operation failed");
      const installed = action === "inspect" ? data.servers?.some((server: { name: string; plugin?: string }) => server.name === plugin && server.plugin === plugin) === true : action === "upsert";
      setReceipt({ revision: data.revision, installed });
      setMessage(installed ? "Installed in this project. Tool discovery/execution are separate verification steps." : "Not installed in this project.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Plugin operation failed");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="mt-3 space-y-3 border-t pt-3">
    <p role="status" className="break-words text-xs font-medium">{busy ? "Checking project binding…" : message}</p>
    <p className="text-xs text-muted-foreground">{plugin === "si-coder"
      ? "Installing adds only this project's managed SC binding. Standalone SC and other projects remain unchanged. Provider credentials stay in Integrations."
      : "Installing adds only this project's Batonly MCP binding. Batonly owns project/task/evidence data; the credential stays in Integrations."}</p>
    {plugin === "batonly" && <div className="grid gap-2">
      <Input aria-label="Batonly connection owner" placeholder="MSO connection owner" value={user} disabled={busy} onChange={event => setUser(event.target.value)} />
      <Input aria-label="Batonly named MCP connection" placeholder="Named MCP connection, not a token" value={connection} disabled={busy} onChange={event => setConnection(event.target.value)} />
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" disabled={busy || !project.trim()} onClick={() => void run("inspect")}>Check installation</Button>
      <Button size="sm" disabled={busy || !receipt.revision || (plugin === "batonly" && (!user || !connection))}
        onClick={() => { if (!receipt.installed || window.confirm("Update this project's plugin installation?")) void run("upsert"); }}>{receipt.installed ? "Update installation" : "Install to project"}</Button>
      {receipt.installed && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { if (window.confirm("Uninstall only from this project? Sibling projects, standalone SC, Batonly data, and credentials remain unchanged.")) void run("delete"); }}>Uninstall</Button>}
      <Button variant="ghost" size="sm" onClick={() => openWindow("integrations", "Integrations")}>Open Integrations</Button>
    </div>
    {receipt.installed && <p className="text-xs text-muted-foreground">Installed ≠ verified. Check this exact project with <code>project_mcp_tools</code> and server <code>{plugin}</code>{plugin === "si-coder" ? ", then call sc.version." : ". A successful catalog read does not prove every remote mutation."}</p>}
  </div>;
}
