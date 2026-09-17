"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PluginManifest } from "@/lib/plugins/manifest";
import type { McpMutation, McpSnapshot } from "./use-mcp-installations";
export function BuiltinMcp({ plugin, snapshot, busy, install }: {
  plugin: PluginManifest; snapshot: McpSnapshot; busy: boolean; install: (input: McpMutation) => Promise<boolean>;
}) {
  const [user, setUser] = useState(""), [connection, setConnection] = useState("");
  const installed = snapshot.servers.some(server => server.plugin === plugin.id);
  const collision = snapshot.servers.some(server => server.name === plugin.id && server.plugin !== plugin.id);
  return <article className="min-w-0 space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{plugin.metadata.name}</h3><span className="text-xs text-muted-foreground">{installed ? "Installed" : "Available"} · Catalog {plugin.version}</span></div>
    <p className="text-sm text-muted-foreground">{plugin.metadata.description}</p>
    <p className="text-xs text-muted-foreground">{plugin.id === "si-coder" ? "Uses MSO's managed SC runtime. Shared credentials stay in Integrations." : "Remote MCP connection; this does not download or self-host the Batonly service."}</p>
    {!installed && plugin.id === "batonly" && <div className="grid gap-2">
      <Input aria-label="Batonly connection owner" placeholder="Connection owner" value={user} disabled={busy} onChange={event => setUser(event.target.value)} />
      <Input aria-label="Batonly named MCP connection" placeholder="Named MCP connection, not a token" value={connection} disabled={busy} onChange={event => setConnection(event.target.value)} />
    </div>}
    {!installed && <Button size="sm" disabled={busy || collision || (plugin.id === "batonly" && (!user || !connection))} onClick={() => {
      if (plugin.id !== "si-coder" && plugin.id !== "batonly") return;
      if (window.confirm(`Install ${plugin.metadata.name} on ${snapshot.project}? No other target is changed.`)) void install({ server: plugin.id, plugin: plugin.id, ...(plugin.id === "batonly" ? { user, connection } : {}) });
    }}>{collision ? "Alias already in use" : "Install"}</Button>}
  </article>;
}
