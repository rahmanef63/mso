"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openWindow } from "@/features/appshell";
import type { AgentVaultState, AgentVaultView } from "@/lib/contracts/agent-vault";
import { NotePreview } from "./note-preview";

const KEY = "mso:agent-vault:project";
async function request(project: string, options: { sync?: boolean; note?: string; signal?: AbortSignal } = {}): Promise<AgentVaultView> {
  const params = new URLSearchParams();
  if (project.trim()) params.set("project", project.trim());
  if (options.note) params.set("note", options.note);
  const response = await fetch(`/api/v1/agent-vault?${params}`, options.sync ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project.trim() ? { project: project.trim() } : {}), signal: options.signal,
  } : { cache: "no-store", signal: options.signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as AgentVaultView;
}
export function VaultScreen() {
  const [project, setProject] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem(KEY) || "");
  const [state, setState] = useState<AgentVaultState | null>(null);
  const [snapshotId, setSnapshotId] = useState("");
  const [note, setNote] = useState<{ path: string; content: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false), [noteBusy, setNoteBusy] = useState(false), [error, setError] = useState("");
  const requests = useRef(0), noteRequests = useRef(0);
  const load = useCallback(async (hint: string, sync = false) => {
    const token = ++requests.current;
    ++noteRequests.current;
    setBusy(true); setError(""); setState(null); setNote(null); setNoteBusy(false);
    try {
      const result = await request(hint, { sync });
      if (token !== requests.current) return;
      setState(result.state); setSnapshotId(result.state.current || "");
      setProject(result.state.project.path);
      localStorage.setItem(KEY, result.state.project.path);
    } catch (cause) { if (token === requests.current) setError(cause instanceof Error ? cause.message : "Could not load vault"); }
    finally { if (token === requests.current) setBusy(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController(), token = ++requests.current;
    let alive = true;
    request(localStorage.getItem(KEY) || "", { signal: controller.signal }).then(result => {
      if (!alive || token !== requests.current) return;
      setState(result.state); setSnapshotId(result.state.current || ""); setProject(result.state.project.path);
    }, cause => { if (alive && token === requests.current) setError(cause instanceof Error ? cause.message : "Could not load vault"); });
    return () => { alive = false; controller.abort(); };
  }, []);
  const snapshot = state?.snapshots.find(s => s.id === snapshotId);
  const notes = useMemo(() => snapshot?.notes.filter(n => `${n.title} ${n.kind} ${n.source}`.toLowerCase().includes(filter.toLowerCase())) || [], [snapshot, filter]);
  const selected = snapshot?.notes.find(n => n.path === note?.path);
  async function select(path: string) {
    if (!state) return;
    const token = ++noteRequests.current;
    setNoteBusy(true); setError(""); setNote(null);
    try { const result = await request(state.project.path, { note: path }); if (token === noteRequests.current) setNote(result.note || null); }
    catch (cause) { if (token === noteRequests.current) setError(cause instanceof Error ? cause.message : "Could not read note"); }
    finally { if (token === noteRequests.current) setNoteBusy(false); }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <form className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2" onSubmit={e => { e.preventDefault(); void load(project); }}>
      <Input aria-label="Repository" placeholder="Repository name, id or path" value={project} onChange={e => setProject(e.target.value)} className="min-w-0 flex-1" />
      <Button variant="outline" type="submit" disabled={busy}>Load</Button>
      <Button type="button" disabled={busy} onClick={() => void load(project, true)}><RefreshCw className="mr-1 size-4" />{busy ? "Loading…" : "Refresh snapshot"}</Button>
    </form>
    <details className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Separate Obsidian vault{state ? ` · ${state.project.name}` : ""}{snapshot?.truncated ? " · partial snapshot" : ""}</summary>
      <p className="py-1">Agent progress from your repository. Refresh captures a snapshot; source notes remain authoritative.</p>
      {state ? <div className="flex flex-wrap items-center gap-2"><span className="break-all">{state.root}</span><Button size="sm" variant="ghost" disabled={!state.current} onClick={() => openWindow("files-manager", "Agent Vault files", undefined, { path: state.root })}><FolderOpen className="mr-1 size-4" />Files</Button></div> : null}
      {snapshot?.warnings.length ? <p className="py-1">{snapshot.warnings.join(" · ")}</p> : null}
    </details>
    {error ? <p role="alert" className="px-3 py-2 text-sm text-destructive">{error}</p> : null}
    {state && !state.current ? <p className="p-4 text-sm text-muted-foreground">No snapshot yet. Choose Refresh snapshot to collect repository agent notes, progress summaries and recent commits.</p> : null}
    {snapshot ? <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1">
        <label className="text-xs" htmlFor="vault-snapshot">Snapshot</label>
        <select id="vault-snapshot" className="max-w-full rounded border bg-background px-2 py-1 text-xs" value={snapshotId} onChange={e => { ++noteRequests.current; setSnapshotId(e.target.value); setNote(null); setNoteBusy(false); }}>
          {state?.snapshots.map(s => <option key={s.id} value={s.id}>{new Date(s.capturedAt).toLocaleString()}{s.id === state.current ? " · latest" : ""}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{snapshot.notes.length} notes{snapshot.truncated ? " · partial" : ""}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col @min-[560px]:flex-row">
        <aside className="flex max-h-52 min-h-0 flex-col border-b @min-[560px]:max-h-none @min-[560px]:w-64 @min-[560px]:shrink-0 @min-[560px]:border-r @min-[560px]:border-b-0">
          <div className="p-2"><Input aria-label="Search vault notes" placeholder="Search notes" value={filter} onChange={e => setFilter(e.target.value)} /></div>
          <div className="min-h-0 flex-1 overflow-auto">{notes.map(n => <button key={n.path} type="button" aria-pressed={note?.path === n.path} className={`block w-full border-b px-3 py-2 text-left text-sm hover:bg-muted ${note?.path === n.path ? "bg-muted" : ""}`} onClick={() => void select(n.path)}><span className="block truncate">{n.title}</span><span className="text-xs text-muted-foreground">{n.kind}</span></button>)}</div>
        </aside>
        <article className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
          {noteBusy ? <p className="text-sm text-muted-foreground">Loading note…</p> : note ? <><p className="mb-4 break-all text-xs text-muted-foreground">Source: {selected?.source}</p><NotePreview content={note.content} /></> : <p className="text-sm text-muted-foreground">Select a note to see agent roles, project updates or recorded progress.</p>}
        </article>
      </div>
    </> : null}
  </div>;
}
