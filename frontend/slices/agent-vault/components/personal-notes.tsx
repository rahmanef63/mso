"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openWindow, useOsApi } from "@/features/appshell";
import type { FsEntry, FsList } from "@/lib/contracts/os-api";

/** Personal Markdown uses the existing guarded Files API and Code editor. */
export function PersonalNotes({ root }: { root: string }) {
  const api = useOsApi();
  const directory = `${root}/Notes`;
  const [entries, setEntries] = useState<FsEntry[]>([]), [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/fs/list?${new URLSearchParams({ path: directory })}`, { cache: "no-store", signal });
    const result = await response.json();
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(result.error || "Could not read personal notes");
    return (result as FsList).entries.filter(entry => entry.kind === "file" && entry.name.endsWith(".md"));
  }, [directory]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(next => { if (!controller.signal.aborted) setEntries(next); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not read personal notes"); });
    return () => controller.abort();
  }, [load]);
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
      setTitle(""); setEntries(await load());
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
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Button size="sm" variant="outline" onClick={() => { setError(""); void load().then(setEntries).catch(cause => setError(cause instanceof Error ? cause.message : "Could not read notes")); }}>Reload notes</Button>
    <div className="space-y-2">{entries.map(entry => <Button key={entry.name} variant="outline" disabled={api.mode !== "live"} className="w-full justify-start" onClick={() => openWindow("code-editor", entry.name, undefined, { path: `${directory}/${entry.name}` })}><span className="truncate">{entry.name.replace(/-[a-f\d-]{36}\.md$/, "").replace(/\.md$/, "")}</span></Button>)}</div>
    {!error && !entries.length ? <p className="text-sm text-muted-foreground">Create your first personal note.</p> : null}
  </section>;
}
