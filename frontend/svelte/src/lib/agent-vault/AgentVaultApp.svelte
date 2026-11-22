<script lang="ts">
  import {
    createAgentVaultController,
    type AgentVaultKind,
    type AgentVaultSnapshot,
    type AgentVaultViewState,
  } from "./agent-vault-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<AgentVaultViewState>({ kind: "loading", project: "" });
  let projectInput = $state("");
  let controller: ReturnType<typeof createAgentVaultController> | undefined;

  let isOwner = $derived(role === "owner");

  let activeSnapshot = $derived.by<AgentVaultSnapshot | null>(() => {
    if (view.kind !== "ready") return null;
    const { current, snapshots } = view.vault.state;
    if (current) {
      const exact = snapshots.find((s) => s.id === current);
      if (exact) return exact;
    }
    return snapshots[0] ?? null;
  });

  let busy = $derived(view.kind === "loading" || (view.kind === "ready" && (view.syncing || view.readingNote)));

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (!activeSnapshot || activeSnapshot.notes.length === 0) return "empty";
    return "ready";
  });

  function kindTone(kind: AgentVaultKind): "ok" | "warn" | "neutral" {
    if (kind === "overview" || kind === "project") return "ok";
    if (kind === "inbox" || kind === "progress") return "warn";
    return "neutral";
  }

  function formatTime(iso: string | null): string {
    if (!iso) return "Never";
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
  }

  function handleLoad(event?: Event) {
    event?.preventDefault();
    if (isOwner) void controller?.load({ project: projectInput });
  }

  function handleSync() {
    if (isOwner) void controller?.sync(projectInput);
  }

  function handleOpenNote(notePath: string) {
    if (!isOwner || view.kind !== "ready") return;
    const project = projectInput.trim() || view.vault.state.project.id;
    void controller?.load({ project, note: notePath });
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
</script>

<section aria-labelledby="agent-vault-title" aria-busy={isOwner && busy} data-agent-vault-state={stateTag}>
  <header class="feature-header">
    <h2 id="agent-vault-title">Agent Vault</h2>
    {#if isOwner && view.kind === "ready"}
      <span class="pill" data-tone="ok">{view.vault.state.project.name}</span>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect or sync the agent vault. Sign in from an Owner device to view repository snapshots and notes.
    </p>
  {:else}
    <form class="av-controls" onsubmit={handleLoad}>
      <div class="field">
        <label for="av-project">Repository</label>
        <input id="av-project" type="text" bind:value={projectInput} placeholder="Repository id, name, or path" />
      </div>
      <div class="av-actions">
        <button type="submit" disabled={busy}>
          {view.kind === "loading" ? "Loading..." : "Load"}
        </button>
        <button type="button" class="primary" disabled={busy} onclick={handleSync}>
          {view.kind === "ready" && view.syncing ? "Syncing..." : "Sync"}
        </button>
      </div>
    </form>

    {#if view.kind === "loading"}
      <p role="status">Loading agent vault...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if view.notice}<p class="feedback ok" role="status">{view.notice}</p>{/if}
      {#if view.actionError}<p class="feedback error" role="alert">{view.actionError}</p>{/if}

      <div class="av-summary" aria-label="Vault snapshot summary">
        <div class="av-badges">
          <span class="pill">{view.vault.state.snapshots.length} {view.vault.state.snapshots.length === 1 ? "snapshot" : "snapshots"}</span>
          {#if activeSnapshot}
            <span class="pill" data-tone="ok">{activeSnapshot.notes.length} {activeSnapshot.notes.length === 1 ? "note" : "notes"}</span>
            {#if activeSnapshot.truncated}<span class="pill" data-tone="warn">truncated</span>{/if}
          {/if}
        </div>
        <p class="av-meta">Project: <code>{view.vault.state.project.path}</code> | Refreshed: {formatTime(view.vault.state.refreshedAt)}</p>
        <p class="av-meta">Vault root: <code>{view.vault.state.root}</code>{#if activeSnapshot} | Snapshot: <code>{activeSnapshot.id.slice(0, 12)}</code>{/if}</p>
        {#if activeSnapshot && activeSnapshot.warnings.length > 0}
          <p class="feedback pending" role="status">{activeSnapshot.warnings.join(" | ")}</p>
        {/if}
      </div>

      {#if !activeSnapshot || activeSnapshot.notes.length === 0}
        <p>No snapshots or notes have been captured yet. Click Sync to build a snapshot.</p>
      {:else}
        <div class="av-layout">
          <ul class="av-list" aria-label="Vault notes">
            {#each activeSnapshot.notes as item (item.path)}
              <li>
                <button
                  type="button"
                  class="av-note-btn"
                  class:selected={view.vault.note?.path === item.path}
                  aria-pressed={view.vault.note?.path === item.path}
                  disabled={view.readingNote}
                  onclick={() => handleOpenNote(item.path)}
                >
                  <span class="av-note-title">{item.title}</span>
                  <span class="pill" data-tone={kindTone(item.kind)}>{item.kind}</span>
                </button>
              </li>
            {/each}
          </ul>

          <div class="av-viewer" aria-label="Note viewer">
            {#if view.readingNote}
              <p role="status">Loading note...</p>
            {:else if view.vault.note}
              <p class="av-meta">Note: <code>{view.vault.note.path}</code></p>
              <pre class="av-note-body">{view.vault.note.content}</pre>
            {:else}
              <p class="av-meta">Select a note from the list to read its plain-text content.</p>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .av-controls { display: grid; grid-template-columns: 1fr auto; gap: 0.75rem; align-items: end; margin: 0.75rem 0 1rem; }
  @media (max-width: 34rem) { .av-controls { grid-template-columns: 1fr; } }
  .av-actions { display: inline-flex; gap: 0.5rem; flex-wrap: wrap; }
  .av-summary { display: grid; gap: 0.375rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); margin-bottom: 0.75rem; }
  .av-badges { display: flex; flex-wrap: wrap; gap: 0.375rem; }
  .av-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .av-layout { display: grid; grid-template-columns: minmax(14rem, 1fr) minmax(16rem, 1.3fr); gap: 0.75rem; align-items: start; }
  @media (max-width: 44rem) { .av-layout { grid-template-columns: 1fr; } }
  .av-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.375rem; max-height: 22rem; overflow-y: auto; }
  .av-note-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; text-align: left; }
  .av-note-btn.selected { border-color: var(--accent); background: var(--surface); }
  .av-note-title { font-weight: 600; overflow-wrap: anywhere; }
  .av-viewer { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); display: grid; gap: 0.5rem; min-width: 0; }
  .av-note-body { margin: 0; font-size: 0.8125rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 22rem; overflow-y: auto; font-family: var(--font-mono, monospace); color: var(--text); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
