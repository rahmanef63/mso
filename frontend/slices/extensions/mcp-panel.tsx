"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openWindow } from "@/features/appshell";
import { BUILT_IN_PLUGINS } from "@/lib/plugins/manifest";
import { ExtensionAccess } from "./access";
import { useMcpInstallations } from "./use-mcp-installations";
import { InstalledMcp } from "./mcp-installed";
import { BuiltinMcp } from "./mcp-builtin";
import { RemoteMcpForm } from "./mcp-remote-form";
export function McpStorePanel() { return <ExtensionAccess><OwnerMcpPanel /></ExtensionAccess>; }
function OwnerMcpPanel() {
  const [target, setTarget] = useState("@host"), [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const { snapshot, busy, error, reload, mutate } = useMcpInstallations(target);
  const q = query.trim().toLowerCase();
  return <div className="min-w-0 space-y-4">
    <section className="space-y-3 rounded-lg border p-3">
      <h2 className="text-sm font-semibold">MCP on this VPS</h2>
      <p className="text-sm text-muted-foreground">Choose this MSO host or one exact project. Host installs are not inherited by projects; removing a connection leaves provider data and credentials untouched.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={target === "@host" ? "default" : "secondary"} disabled={busy} onClick={() => setTarget("@host")}>This MSO host</Button>
        <Input className="min-w-0 flex-1 basis-40" aria-label="Exact MCP target project" placeholder="Exact project name, ID or path" value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
        <Button size="sm" variant="secondary" disabled={busy || !draft.trim()} onClick={() => setTarget(draft.trim())}>Use project</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reload()}>Refresh</Button>
      </div>
      <p className="break-all text-xs font-medium">Target: {target === "@host" ? "This MSO host" : target}</p>
      <Input aria-label="Search MCPs" placeholder="Search MCPs" value={query} onChange={event => setQuery(event.target.value)} />
    </section>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {busy && <p role="status" className="text-sm text-muted-foreground">Updating host installation state…</p>}
    {snapshot && <>
      <section className="space-y-2"><h3 className="text-sm font-semibold">Installed on this target ({snapshot.servers.length})</h3>
        {snapshot.servers.length === 0 && <p className="text-sm text-muted-foreground">No MCP installed on this target.</p>}
        {snapshot.servers.filter(server => `${server.name} ${server.plugin ?? ""}`.toLowerCase().includes(q)).map(server => <InstalledMcp key={`${target}:${snapshot.revision}:${server.name}`} target={target} server={server} busy={busy} remove={() => { if (window.confirm(`Uninstall ${server.name} only from ${target}? Shared runtime, credentials and remote service data will not be deleted.`)) void mutate("delete", { server: server.name }); }} />)}
      </section>
      <section className="space-y-2"><h3 className="text-sm font-semibold">Available MCPs</h3><div className="grid gap-3 @lg:grid-cols-2">{BUILT_IN_PLUGINS.filter(plugin => `${plugin.metadata.name} ${plugin.metadata.description}`.toLowerCase().includes(q)).map(plugin => <BuiltinMcp key={`${target}:${plugin.id}`} plugin={plugin} snapshot={snapshot} busy={busy} install={input => mutate("upsert", input)} />)}</div></section>
      <RemoteMcpForm key={target} busy={busy} aliases={snapshot.servers.map(server => server.name)} install={input => mutate("upsert", input)} />
    </>}
    <div className="space-y-2 rounded-lg bg-muted/50 p-3"><p className="text-sm font-medium">ChatGPT → MSO → installed MCP</p><p className="text-xs text-muted-foreground">Inspect aliases with project_mcp_manage, discover live schemas with project_mcp_tools, then execute with project_mcp_call. Use project=@host for host installs. Permissions, revocation and private connections are checked on the server.</p><Button size="sm" variant="secondary" onClick={() => openWindow("integrations", "Integrations")}>Manage credentials in Integrations</Button></div>
  </div>;
}
