<script lang="ts">
  import {
    createAgentVaultController,
    type AgentVaultKind,
    type AgentVaultNote,
    type AgentVaultSnapshot,
    type AgentVaultViewState,
  } from "./agent-vault-api.ts";
  import { backlinksOf, resolveNoteLink } from "./note-links.ts";
  import { readVaultBacklinks } from "./vault-backlinks.ts";
  import NotePreview from "./NotePreview.svelte";
  import VaultTree from "./VaultTree.svelte";
  import VaultPanel from "./VaultPanel.svelte";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  const KINDS: AgentVaultKind[] = ["overview", "agent", "project", "progress", "inbox", "memory"];

  let view = $state<AgentVaultViewState>({ kind: "loading", project: "" });
  let projectInput = $state("");
  let filter = $state("");
  let kind = $state("all");
  let selectedPath = $state<string | null>(null);
  let collapsed = $state(true);
  let backlinks = $state<AgentVaultNote[]>([]);
  let controller: ReturnType<typeof createAgentVaultController> | undefined;

  let isOwner = $derived(role === "owner");

  let activeSnapshot = $derived.by<AgentVaultSnapshot | null>(() => {
    if (view.kind !== "ready") return null;
    const { current, snapshots } = view.vault.state;
    if (current) {
      const exact = snapshots.find((snapshot) => snapshot.id === current);
      if (exact) return exact;
    }
    return snapshots[0] ?? null;
  });

  let note = $derived.by<AgentVaultNote | null>(() => {
    const open = view.kind === "ready" ? view.vault.note : undefined;
    if (!open || !activeSnapshot) return null;
    return activeSnapshot.notes.find((item) => item.path === open.path)
      ?? { path: open.path, title: open.path.split("/").pop() ?? open.path, kind: "overview", source: "" };
  });

  let noteContent = $derived(view.kind === "ready" ? view.vault.note?.content ?? null : null);
  let busy = $derived(view.kind === "loading" || (view.kind === "ready" && (view.syncing || view.readingNote)));

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (!activeSnapshot || activeSnapshot.notes.length === 0) return "empty";
    return "ready";
  });

  function formatTime(iso: string | null): string {
    if (!iso) return "Never";
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
  }

  function handleLoad(event?: Event) {
    event?.preventDefault();
    if (!isOwner) return;
    selectedPath = null;
    backlinks = [];
    void controller?.load({ project: projectInput });
  }

  function handleSync() {
    if (isOwner) void controller?.sync(projectInput);
  }

  function openNote(path: string) {
    if (!isOwner || view.kind !== "ready") return;
    const project = projectInput.trim() || view.vault.state.project.id;
    selectedPath = path;
    collapsed = false;
    void controller?.load({ project, note: path });
  }

  function resolveLink(target: string, wiki: boolean): string | undefined {
    if (!activeSnapshot) return undefined;
    return resolveNoteLink(activeSnapshot.notes, note?.path ?? "", target, wiki)?.path;
  }

  export function refresh() {
    if (isOwner) void controller?.load({ project: projectInput });
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      controller = undefined;
      return;
    }
    const next = createAgentVaultController((s) => { view = s; });
    controller = next;
    void next.load({});
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });

  // Backlink projection is only fetched where the graph exists; failures degrade to none.
  $effect(() => {
    const snapshot = activeSnapshot;
    const path = selectedPath;
    if (!isOwner || view.kind !== "ready" || !snapshot || !path) { backlinks = []; return; }
    const controllerRef = new AbortController();
    void readVaultBacklinks(view.vault.state.root, view.vault.state.project.path, snapshot.notes, path, controllerRef.signal)
      .then((rows) => { if (!controllerRef.signal.aborted) backlinks = rows; })
      .catch(() => { if (!controllerRef.signal.aborted) backlinks = []; });
    return () => controllerRef.abort();
  });

  // Local wikilink fallback keeps the panel useful when the graph projection is unavailable.
  let localBacklinks = $derived.by<AgentVaultNote[]>(() => {
    if (!activeSnapshot || !note || !noteContent) return backlinks;
    const contents = new Map<string, string>();
    contents.set(note.path, noteContent);
    const local = backlinksOf(activeSnapshot.notes, contents, note.path);
    return local.length > 0 ? local : backlinks;
  });
</script>

<section aria-labelledby="agent-vault-title" aria-busy={isOwner && busy} data-agent-vault-state={stateTag}>
  <header class="feature-header">
    <div class="av-title-wrap">
      <h2 id="agent-vault-title">{view.kind === "ready" ? view.vault.state.project.name : "Agent Vault"}</h2>
      {#if activeSnapshot}
        <span class="pill">{activeSnapshot.notes.length} {activeSnapshot.notes.length === 1 ? "note" : "notes"}</span>
        <span class="pill">captured {formatTime(activeSnapshot.capturedAt)}</span>
      {/if}
      {#if activeSnapshot?.truncated}<span class="pill" data-tone="warn">partial</span>{/if}
    </div>
    {#if isOwner && view.kind === "ready"}
      <div class="actions">
        <span class="pill">{view.vault.state.snapshots.length} {view.vault.state.snapshots.length === 1 ? "snapshot" : "snapshots"}</span>
      </div>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect or sync the agent vault. Sign in from an Owner device to view repository snapshots and notes.
    </p>
  {:else}
    <details class="av-source" open={!note}>
      <summary>Repository and storage</summary>
      <form class="av-controls" onsubmit={handleLoad}>
        <div class="field">
          <label for="av-project">Repository</label>
          <input id="av-project" type="text" bind:value={projectInput} placeholder="Repository id, name, or path" />
        </div>
        <button type="submit" disabled={busy}>{view.kind === "loading" ? "Loading..." : "Load"}</button>
      </form>
      {#if view.kind === "ready"}
        <p class="av-meta">Vault root: <code>{view.vault.state.root}</code></p>
        <p class="av-meta">Refreshed: {formatTime(view.vault.state.refreshedAt)}</p>
      {/if}
    </details>

    {#if view.kind === "loading"}
      <p role="status">Loading agent vault...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if view.notice}<p class="feedback ok" role="status">{view.notice}</p>{/if}
      {#if view.actionError}<p class="feedback error" role="alert">{view.actionError}</p>{/if}

      {#if !activeSnapshot || activeSnapshot.notes.length === 0}
        <p>No snapshots or notes have been captured yet. Press Sync Vault to build one.</p>
      {:else}
        <div class="av-workspace" class:collapsed>
          <VaultTree
            notes={activeSnapshot.notes}
            selectedPath={selectedPath}
            {filter}
            {kind}
            kinds={KINDS}
            onfilter={(value) => { filter = value; }}
            onkind={(value) => { kind = value; }}
            onopen={openNote}
            onsync={handleSync}
            syncing={view.syncing}
          />

          <article class="av-reader" aria-label="Note reader" aria-busy={view.readingNote}>
            {#if view.readingNote}
              <p role="status" class="av-meta">Loading note...</p>
            {:else if view.vault.note}
              <p class="av-breadcrumb">{view.vault.note.path}</p>
              <NotePreview content={view.vault.note.content} resolve={resolveLink} onopen={openNote} />
            {:else}
              <p class="av-meta">Choose a note from the tree to read it. Wikilinks jump between notes in this snapshot.</p>
            {/if}
          </article>

          <VaultPanel note={note} content={noteContent} snapshot={activeSnapshot} backlinks={localBacklinks} onopen={openNote} />
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .av-title-wrap { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .av-source { margin: 0.75rem 0 0.5rem; font-size: 0.8125rem; color: var(--muted); }
  .av-source summary { cursor: pointer; min-height: 1.75rem; }
  .av-controls { display: flex; gap: 0.5rem; align-items: end; flex-wrap: wrap; padding: 0.5rem 0; }
  .av-controls .field { flex: 1 1 12rem; min-width: 0; }
  .av-controls input { width: 100%; min-width: 0; }
  .av-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .av-workspace { display: grid; grid-template-columns: minmax(12rem, 0.95fr) minmax(0, 2.1fr) minmax(12rem, 0.85fr); gap: 0.75rem; align-items: stretch; min-height: 26rem; }
  .av-workspace.collapsed { grid-template-columns: minmax(10rem, 0.7fr) minmax(0, 2.4fr) minmax(11rem, 0.7fr); }
  @media (max-width: 62rem) {
    .av-workspace, .av-workspace.collapsed { grid-template-columns: minmax(11rem, 0.9fr) minmax(0, 2fr); }
    .av-workspace > :global(.vault-panel) { grid-column: 1 / -1; }
  }
  @media (max-width: 44rem) {
    .av-workspace, .av-workspace.collapsed { grid-template-columns: 1fr; }
    .av-workspace > :global(.vault-tree) { max-height: 15rem; }
    .av-workspace > :global(.av-reader) { min-height: 18rem; }
  }
  .av-reader { display: grid; gap: 0.75rem; align-content: start; padding: 0.875rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel-solid); min-width: 0; max-height: min(70vh, 34rem); overflow-y: auto; }
  .av-breadcrumb { margin: 0; font-size: 0.7rem; font-family: var(--font-mono); color: var(--muted); overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
