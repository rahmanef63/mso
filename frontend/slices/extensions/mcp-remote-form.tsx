"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validatePluginManifest, type PluginManifest } from "@/lib/plugins/manifest";
import type { McpMutation } from "./use-mcp-installations";
export function RemoteMcpForm({ busy, aliases, install }: { busy: boolean; aliases: string[]; install: (input: McpMutation) => Promise<boolean> }) {
  const [server, setServer] = useState(""), [url, setUrl] = useState("");
  const [user, setUser] = useState(""), [connection, setConnection] = useState("");
  const [legacy, setLegacy] = useState<PluginManifest[]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
    try {
      const entries: unknown = JSON.parse(localStorage.getItem("mso:custom-plugin-registry:v1") || "[]");
      if (Array.isArray(entries)) setLegacy(entries.flatMap(value => { const result = validatePluginManifest(value); return result.ok ? [result.manifest] : []; }));
    } catch { /* Browser-only declarations are never automatically installed. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return <section className="space-y-3 rounded-lg border p-3">
    <h3 className="text-sm font-semibold">Add an external MCP</h3>
    <p className="text-xs text-muted-foreground">Writes the selected target’s MCP manifest on this VPS. HTTPS endpoints only; use Integrations for OAuth or secrets. Existing local stdio MCPs also appear above.</p>
    {legacy.length > 0 && <div className="space-y-2"><p className="text-xs text-muted-foreground">Previous browser-only declarations remain saved. Review an endpoint before installing:</p>{legacy.map(item => {
      const remote = item.mcp?.find(mcp => mcp.transport === "https");
      return <Button key={item.id} size="sm" variant="secondary" disabled={!remote || busy} onClick={() => { if (remote?.transport === "https") { setServer(item.id); setUrl(remote.endpoint); } }}>{item.metadata.name}{!remote ? " — manual runtime review required" : " — review"}</Button>;
    })}</div>}
    <div className="grid gap-2 sm:grid-cols-2">
      <Input aria-label="MCP alias" placeholder="MCP alias" value={server} disabled={busy} onChange={event => setServer(event.target.value)} />
      <Input aria-label="MCP HTTPS endpoint" placeholder="https://service.example/mcp" value={url} disabled={busy} onChange={event => setUrl(event.target.value)} />
      <Input aria-label="MCP connection owner" placeholder="Connection owner (optional)" value={user} disabled={busy} onChange={event => setUser(event.target.value)} />
      <Input aria-label="MCP named connection" placeholder="Named connection (optional)" value={connection} disabled={busy} onChange={event => setConnection(event.target.value)} />
    </div>
    <Button size="sm" disabled={busy || !server.trim() || !url.trim() || aliases.includes(server.trim()) || Boolean(user) !== Boolean(connection)} onClick={() => {
      if (window.confirm("Install this remote MCP connection on the selected target? Its tools will be callable only with the existing MSO and provider permissions.")) void install({ server: server.trim(), url: url.trim(), ...(user && connection ? { user: user.trim(), connection: connection.trim() } : {}) });
    }}>{aliases.includes(server.trim()) ? "Choose an unused alias" : "Install remote MCP"}</Button>
  </section>;
}
