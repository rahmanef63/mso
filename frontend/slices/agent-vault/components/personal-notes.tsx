"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openWindow, useOsApi } from "@/features/appshell";
import type { useWorkspace } from "../lib/use-workspace";

/** Personal Markdown uses the existing guarded Files API and Code editor. */
export function PersonalNotes({ workspace }: { workspace: ReturnType<typeof useWorkspace> }) {
  const {document,loadPersonal,personalError}=workspace;
  const root=workspace.vault.state!.root;
  const api = useOsApi();
  const directory = `${root}/Notes`;
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const entries = document.nodes.filter(node=>node.group==="Personal notes"&&node.kind==="note");
  useEffect(()=>{void loadPersonal();},[loadPersonal]);
  async function create() {
    const heading = title.trim();
    if (!heading || busy || api.mode !== "live") return;
    setBusy(true); setError("");
    try {
      const name = `${heading.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "note"}-${crypto.randomUUID()}.md`;
      const path = `${directory}/${name}`;
      for (const [operation, body] of [["mkdir", { path: directory }], ["write", { path, content: `# ${heading.replace(/[\r\n]/g, " ")}\n\n` }]] as const) {
        const response = await fetch(`/api/v1/fs/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Could not create note"); }
      }
      setTitle(""); await loadPersonal(true);
      openWindow("code-editor", heading, undefined, { path });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create note"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4" aria-label="Personal notes">
    <h1 className="text-xl font-semibold">Personal notes</h1>
    <p className="text-sm text-muted-foreground">Your Markdown notes are stored separately from generated snapshots. Open a note in the MSO editor to write and save.</p>
    {api.mode !== "live" ? <p className="text-sm text-muted-foreground">Choose Live in Settings → Server to edit host notes.</p> : null}
    <form className="flex min-w-0 gap-2" onSubmit={event => { event.preventDefault(); void create(); }}>
      <Input aria-label="New note title" maxLength={120} placeholder="Note title" className="min-w-0 flex-1" value={title} onChange={event => setTitle(event.target.value)} />
      <Button type="submit" disabled={busy || !title.trim() || api.mode !== "live"}>{busy ? "Creating…" : "New note"}</Button>
    </form>
    {error||personalError ? <p role="alert" className="text-sm text-destructive">{error||personalError}</p> : null}
    <Button size="sm" variant="outline" onClick={() => { setError(""); void loadPersonal(true); }}>Reload notes</Button>
    <div className="space-y-2">{entries.map(entry => <Button key={entry.id} variant="outline" disabled={api.mode !== "live"} className="w-full justify-start" onClick={() => openWindow("code-editor", entry.title, undefined, { path: entry.path })}><span className="truncate">{entry.title}</span></Button>)}</div>
    {!error && !personalError && !entries.length ? <p className="text-sm text-muted-foreground">Create your first personal note.</p> : null}
  </section>;
}
