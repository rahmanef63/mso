"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PublicProjectMcpServer } from "@/lib/contracts/project-mcp";
export function InstalledMcp({ target, server, busy, remove }: { target: string; server: PublicProjectMcpServer; busy: boolean; remove: () => void }) {
  const [checking, setChecking] = useState(false), [error, setError] = useState("");
  const [tools, setTools] = useState<{ name: string }[] | null>(null), [cursor, setCursor] = useState<string | undefined>();
  async function inspect(next?: string) {
    setChecking(true); setError("");
    try {
      const response = await fetch("/api/v1/project-mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tools", project: target, server: server.name, limit: 20, refresh: !next, ...(next ? { cursor: next } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Tool discovery failed");
      setTools(previous => next ? [...(previous ?? []), ...result.tools] : result.tools); setCursor(result.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Tool discovery failed"); }
    finally { setChecking(false); }
  }
  return <article className="min-w-0 space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><h3 className="break-all text-sm font-medium">{server.name}</h3><p className="text-xs text-muted-foreground">{server.transport} · {server.auth} · {tools ? "Tool discovery verified" : "Installed, not yet health-verified"}</p></div>
      <Button size="sm" variant="secondary" disabled={busy || checking} onClick={() => void inspect()}>Check tools</Button>
      <Button size="sm" variant="ghost" disabled={busy || checking} onClick={remove}>Uninstall</Button></div>
    {checking && <p role="status" className="text-xs">Discovering live tool schemas…</p>}{error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
    {tools && <div className="space-y-2"><p className="text-xs text-muted-foreground">{tools.length} tools loaded{cursor ? "; more available" : ""}. Discovery does not prove every remote action.</p><div className="flex flex-wrap gap-1">{tools.map(tool => <code key={tool.name} className="max-w-full break-all rounded bg-muted px-1 text-xs">{tool.name}</code>)}</div>{cursor && <Button size="sm" variant="secondary" disabled={checking || tools.length >= 200} onClick={() => void inspect(cursor)}>Load more tools</Button>}</div>}
  </article>;
}
