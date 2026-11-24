<script lang="ts">
  import {
    createChannelsWorkspaceController,
    type ChannelsWorkspaceState,
  } from "./channels-workspace.ts";
  import type { ChannelDraft, ChannelRecordView } from "./channels-api.ts";
  import { channelHealth, draftValid } from "./channels-draft.ts";
  import ChannelCard from "./ChannelCard.svelte";
  import ChannelEditor from "./ChannelEditor.svelte";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<ChannelsWorkspaceState>({ kind: "loading" });
  let filterQuery = $state("");
  let editor = $state<ChannelRecordView | "new" | null>(null);
  let editorBusy = $state(false);
  let editorError = $state("");
  let notice = $state("");
  let controller: ReturnType<typeof createChannelsWorkspaceController> | undefined;

  let isOwner = $derived(role === "owner");

  let channels = $derived.by<ChannelRecordView[]>(() => (view.kind === "ready" ? view.workspace.channels : []));
  let workflowNames = $derived.by<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (view.kind === "ready") for (const workflow of view.workspace.workflows) map.set(workflow.id, workflow.name);
    return map;
  });

  let visible = $derived.by<ChannelRecordView[]>(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((row) => {
      const health = channelHealth({
        enabled: row.enabled, connectionState: row.connectionState, connectionError: row.connectionError,
        lastCheckOk: row.lastCheck ? row.lastCheck.ok : null,
      });
      return `${row.name} ${row.provider} ${row.credentialUser} ${row.credentialConnection} ${health} ${row.defaultTarget ?? ""}`
        .toLowerCase().includes(q);
    });
  });

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (channels.length === 0) return "empty";
    return visible.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    if (isOwner) void controller?.refresh();
  }

  function openEditor(target: ChannelRecordView | "new") {
    editorError = "";
    editor = target;
  }

  function closeEditor() {
    editor = null;
    editorError = "";
  }

  async function save(draft: ChannelDraft) {
    if (!controller || editorBusy) return;
    editorBusy = true;
    editorError = "";
    const row = editor === "new" ? null : editor;
    const ok = await controller.save(row, draft);
    editorBusy = false;
    if (ok) {
      notice = row ? `${draft.name} updated.` : `${draft.name} created.`;
      editor = null;
      return;
    }
    editorError = "The channel was not saved. Your draft is still here; reload the list to compare revisions.";
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      controller = undefined;
      editor = null;
      return;
    }
    const next = createChannelsWorkspaceController((state) => { view = state; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });
</script>

<section aria-labelledby="channels-title" aria-busy={view.kind === "loading"} data-channels-state={stateTag}>
  <header class="feature-header">
    <h2 id="channels-title">Channels</h2>
    {#if isOwner}
      <div class="actions">
        <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
          {view.kind === "loading" ? "Loading..." : "Refresh"}
        </button>
        <button type="button" class="primary" disabled={view.kind !== "ready"} onclick={() => openEditor("new")}>Add channel</button>
      </div>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to view, test and edit messaging channels. Sign in from an Owner device to check
      channel connectivity.
    </p>
  {:else}
    {#if notice}<p class="feedback ok" role="status">{notice}</p>{/if}

    {#if editor}
      <ChannelEditor
        row={editor === "new" ? null : editor}
        credentials={view.kind === "ready" ? view.workspace.credentials : []}
        workflows={view.kind === "ready" ? view.workspace.workflows : []}
        groups={view.kind === "ready" ? view.workspace.groups : []}
        busy={editorBusy}
        error={editorError}
        onSave={(draft) => void save(draft)}
        onCancel={closeEditor}
      />
    {/if}

    <div class="ch-filter-wrap">
      <label for="channels-filter">Filter channels</label>
      <input id="channels-filter" type="search" bind:value={filterQuery} placeholder="Name, provider, credential, or status" />
    </div>

    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Loading configured channels...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
        <div class="actions"><button type="button" onclick={refresh}>Retry</button></div>
      {:else if channels.length === 0}
        <div class="ch-empty">
          <h3>Connect MSO to a conversation channel</h3>
          <p>
            Telegram and Discord share one channel contract. Bot credentials stay in Integrations; verified inbound
            events can start native workflows.
          </p>
          <div class="actions">
            <button type="button" class="primary" onclick={() => openEditor("new")}>Add channel</button>
            <button type="button" disabled>Open Integrations from the dock</button>
          </div>
        </div>
      {:else if visible.length === 0}
        <p>No channels match "{filterQuery.trim()}".</p>
      {:else}
        <div class="ch-grid" aria-label="Configured messaging channels">
          {#each visible as row (row.id)}
            {@const feedback = view.tests[row.id]}
            <ChannelCard
              {row}
              workflowName={row.workflowId ? workflowNames.get(row.workflowId) ?? null : null}
              {feedback}
              onEdit={() => openEditor(row)}
              onToggle={(enabled) => void controller?.toggle(row.id, enabled)}
              onDelete={() => void controller?.remove(row.id)}
              onTest={() => void controller?.runTest(row.id)}
              onSend={(target, text) => void controller?.send(row.id, target, text)}
            />
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .ch-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .ch-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .ch-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .ch-grid { display: grid; gap: 0.625rem; grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr)); min-width: 0; }
  .ch-empty { display: grid; gap: 0.5rem; padding: 0.875rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .ch-empty h3 { margin: 0; }
  .ch-empty p { margin: 0; font-size: 0.875rem; color: var(--muted); }
  section { display: grid; gap: 0.75rem; align-content: start; }
  @media (max-width: 420px) { .actions button { flex: 1 1 100%; } }
</style>
