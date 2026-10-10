"use client";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, FolderOpen, Network, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openWindow } from "@/features/appshell";
import { useSession } from "@/features/auth";
import { resolveNoteLink } from "../lib/note-links";
import { useVault } from "../lib/use-vault";
import { NotePreview } from "./note-preview";
import { VaultConnections } from "./vault-connections";
import { VaultHistory } from "./vault-history";
import { PersonalNotes } from "./personal-notes";
import styles from "./vault-screen.module.css";

export function VaultScreen() {
  const vault = useVault();
  const { state, snapshotId, note, selectedPath, busy, noteBusy, error, select } = vault;
  const { status, role } = useSession();
  const [filter, setFilter] = useState(""), [kind, setKind] = useState("all");
  const [mobileReader, setMobileReader] = useState(false), [history, setHistory] = useState(false);
  const [personal, setPersonal] = useState(false);
  const snapshot = state?.snapshots.find(s => s.id === snapshotId);
  const notes = useMemo(() => snapshot?.notes.filter(n => (kind === "all" || n.kind === kind) && `${n.title} ${n.kind} ${n.source}`.toLowerCase().includes(filter.toLowerCase())) || [], [snapshot, filter, kind]);
  const selected = snapshot?.notes.find(n => n.path === selectedPath);
  const graphRoot = state && snapshot ? `${state.root}/Snapshots/${snapshot.id}` : "";
  const openNote = useCallback((path: string) => { setPersonal(false); setMobileReader(true); void select(path); }, [select]);
  const resolveLink = useCallback((target: string, wiki: boolean) => resolveNoteLink(snapshot?.notes || [], note?.path || "", target, wiki)?.path, [snapshot, note?.path]);
  function chooseSnapshot(id: string) { setPersonal(false); setMobileReader(false); setHistory(false); vault.chooseSnapshot(id); }

  if (status !== "in" || role !== "owner") return <p className="p-4 text-sm text-muted-foreground">Owner access is required to open private repository notes.</p>;
  return <div data-slot="native-vault" className="flex h-full min-h-0 min-w-0 flex-col">
    <header className="flex min-w-0 shrink-0 items-center gap-2 border-b px-3 py-2">
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{state?.project.name || "Agent Vault"}</h2><p className="truncate text-xs text-muted-foreground">{snapshot ? `${snapshot.notes.length} notes · ${new Date(snapshot.capturedAt).toLocaleString()}` : "Repository knowledge and recorded progress"}</p></div>
      <Button size="sm" variant="outline" aria-label="Open Memory graph" disabled={!snapshot || busy} onClick={() => openWindow("memory-graph", "Memory", undefined, { root: graphRoot, project: state!.project.path })}><Network className="size-4" /><span className="hidden @min-[480px]:inline">Memory</span></Button>
      <Button size="sm" variant="outline" aria-label="Open Organization" onClick={() => openWindow("organization", "Organization")}><Users className="size-4" /><span className="hidden @min-[480px]:inline">Organization</span></Button>
      <Button size="sm" disabled={busy} onClick={() => { setMobileReader(false); void vault.load(state?.project.path || vault.project, true); }}><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /><span>{busy ? "Loading…" : "Refresh snapshot"}</span></Button>
    </header>
    <details className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Repository &amp; storage{snapshot?.truncated ? " · partial snapshot" : ""}</summary>
      <form className="flex min-w-0 gap-2 py-2" onSubmit={e => { e.preventDefault(); setMobileReader(false); void vault.load(vault.project); }}>
        <Input aria-label="Repository" placeholder="Repository name, id or path" value={vault.project} onChange={e => vault.setProject(e.target.value)} className="min-w-0 flex-1" />
        <Button size="sm" variant="outline" type="submit" disabled={busy}>Load</Button>
      </form>
      <p>Refresh captures recorded repository evidence. Source notes remain authoritative.</p>
      {state ? <div className="flex flex-wrap items-center gap-2 py-1"><span className="break-all">{state.root}</span><Button size="sm" variant="ghost" onClick={() => openWindow("files-manager", "Vault files", undefined, { path: state.root })}><FolderOpen className="size-4" />Files</Button></div> : null}
    </details>
    {error ? <p role="alert" className="shrink-0 px-3 py-2 text-sm text-destructive">{error}</p> : null}
    {state && !state.current && !busy ? <p className="p-4 text-sm text-muted-foreground">No snapshot yet. Refresh snapshot to collect agent notes, progress and recent commits.</p> : null}
    {snapshot ? <div className="flex min-h-0 min-w-0 flex-1">
      <aside aria-label="Vault navigation" className={`${styles.navigation} ${mobileReader ? "hidden" : "flex"} min-h-0 min-w-0 w-full flex-none flex-col overflow-y-auto border-r`}>
        <div className="shrink-0 space-y-2 border-b p-3">
          <div className="flex flex-wrap items-center justify-between gap-1"><span className="text-xs font-medium">{history ? "Progress history" : "Notes"}</span><Button size="sm" variant="ghost" onClick={() => { setPersonal(true); setMobileReader(true); }}>Personal notes</Button><Button size="sm" variant="ghost" aria-pressed={history} onClick={() => setHistory(!history)}>{history ? "Notes" : "History"}</Button></div>
          {!history ? <>
            <Input aria-label="Search vault notes" placeholder="Search notes" value={filter} onChange={e => setFilter(e.target.value)} />
            <div className="flex min-w-0 items-center gap-2"><select aria-label="Note type" className="min-w-0 flex-1 rounded border bg-background p-1 text-xs" value={kind} onChange={e => setKind(e.target.value)}>{["all", "agent", "project", "progress", "memory", "inbox", "overview"].map(k => <option key={k} value={k}>{k === "all" ? "All notes" : k}</option>)}</select><span className="text-xs text-muted-foreground">{notes.length}</span></div>
          </> : null}
          <select aria-label="Snapshot" className="w-full rounded border bg-background p-1 text-xs" value={snapshotId} onChange={e => chooseSnapshot(e.target.value)}>{state?.snapshots.map(s => <option key={s.id} value={s.id}>{new Date(s.capturedAt).toLocaleString()}{s.id === state.current ? " · latest" : ""}</option>)}</select>
        </div>
        <div className="shrink-0">
          {history ? <VaultHistory state={state!} selected={snapshotId} onSelect={chooseSnapshot} /> : notes.length ? notes.map(n => <button key={n.path} type="button" aria-pressed={selectedPath === n.path} className={`block min-h-11 w-full border-b px-3 py-3 text-left text-sm hover:bg-muted ${selectedPath === n.path ? "bg-muted" : ""}`} onClick={() => openNote(n.path)}><span className="block truncate font-medium">{n.title}</span><span className="text-xs text-muted-foreground">{n.kind}</span></button>) : <p className="p-4 text-sm text-muted-foreground">No matching notes.</p>}
        </div>
      </aside>
      <section aria-label="Note reader" className={`${styles.reader} ${mobileReader ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col`}>
        <div className="flex min-w-0 shrink-0 items-center gap-2 border-b px-3 py-2">
          <Button size="sm" variant="ghost" className={styles.back} onClick={() => setMobileReader(false)}><ArrowLeft className="size-4" />Back to notes</Button>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{personal ? "Personal notes" : selected?.title || "Select a note"}</span>
        </div>
        <article aria-busy={noteBusy} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4" style={{ overscrollBehavior: "contain" }}>
          <div className="mx-auto max-w-3xl">
            {personal ? <PersonalNotes key={state!.root} root={state!.root} /> : noteBusy ? <p role="status" className="text-sm text-muted-foreground">Loading note…</p> : note ? <>
              <p className="mb-4 break-all text-xs text-muted-foreground">Source: {selected?.source}</p>
              <NotePreview content={note.content} resolve={resolveLink} onOpen={openNote} />
            </> : <p className="text-sm text-muted-foreground">Choose an agent, project or progress note. Use History to browse earlier captures.</p>}
            {!personal && selectedPath ? <VaultConnections key={graphRoot} root={graphRoot} project={state!.project.path} notes={snapshot.notes} selectedPath={selectedPath} vaultRoot={state!.root} onOpen={openNote} /> : null}
            {snapshot.warnings.length ? <p className="mt-6 text-xs text-muted-foreground">{snapshot.warnings.join(" · ")}</p> : null}
          </div>
        </article>
      </section>
    </div> : null}
  </div>;
}
