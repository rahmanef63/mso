<script lang="ts">
  import {
    createAgentGroupController,
    type AgentGroupRun,
    type AgentGroupView,
    type AgentGroupViewState,
  } from "./agent-group-api.ts";
  import {
    createAgentGroup, deleteAgentGroup, updateAgentGroup, type AgentGroupDraft,
  } from "./agent-group-mutations.ts";
  import AgentGroupEditorDrawer from "./AgentGroupEditorDrawer.svelte";
  import AgentGroupRoom from "./AgentGroupRoom.svelte";
  import AgentGroupSidebar from "./AgentGroupSidebar.svelte";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<AgentGroupViewState>({ kind: "loading" });
  let filterQuery = $state("");
  let selectedGroupId = $state<string | null>(null);
  let topicInput = $state("");
  let controller: ReturnType<typeof createAgentGroupController> | undefined;
  let editorOpen = $state(false);
  let mutationBusy = $state(false);
  let mutationError = $state("");

  let isOwner = $derived(role === "owner");

  let visibleGroups = $derived.by<AgentGroupView[]>(() => {
    if (view.kind !== "ready") return [];
    const query = filterQuery.trim().toLowerCase();
    if (!query) return view.snapshot.groups;
    return view.snapshot.groups.filter((group) =>
      `${group.name} ${group.id} ${group.enabled ? "enabled" : "disabled"} ${group.members.map((m) => `${m.name} ${m.profile}`).join(" ")} ${group.runs[0]?.state ?? ""}`
        .toLowerCase().includes(query));
  });

  let selectedGroup = $derived.by<AgentGroupView | null>(() => {
    if (view.kind !== "ready") return null;
    if (selectedGroupId) {
      const exact = view.snapshot.groups.find((group) => group.id === selectedGroupId);
      if (exact) return exact;
    }
    return visibleGroups[0] ?? null;
  });

  let activeRun = $derived.by<AgentGroupRun | null>(() => {
    if (!selectedGroup || selectedGroup.runs.length === 0) return null;
    return selectedGroup.runs.find((run) => run.state === "running") ?? selectedGroup.runs[0] ?? null;
  });

  let busy = $derived(view.kind === "loading" || (view.kind === "ready" && view.busyAction !== null));
  let running = $derived(activeRun?.state === "running");

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.snapshot.groups.length === 0) return "empty";
    return visibleGroups.length === 0 ? "no-filter-matches" : "ready";
  });

  function handleStart(event: Event) {
    event.preventDefault();
    if (!isOwner || !selectedGroup || !topicInput.trim() || busy) return;
    const topic = topicInput.trim();
    topicInput = "";
    void controller?.startRun(selectedGroup.id, topic);
  }

  function handleStop(runId: string) {
    if (isOwner && !busy) void controller?.stopRun(runId);
  }

  async function saveGroup(draft: AgentGroupDraft) {
    if (view.kind !== "ready" || mutationBusy) return;
    mutationBusy = true;
    mutationError = "";
    try {
      const signal = new AbortController().signal;
      if (draft.id) await updateAgentGroup(draft, view.snapshot.revision, signal);
      else await createAgentGroup(draft, signal);
      editorOpen = false;
      void controller?.refresh();
    } catch (cause) {
      mutationError = cause instanceof Error ? cause.message : "Could not save the agent group.";
    } finally {
      mutationBusy = false;
    }
  }

  async function removeGroup(group: AgentGroupView) {
    if (view.kind !== "ready" || mutationBusy) return;
    mutationBusy = true;
    mutationError = "";
    try {
      await deleteAgentGroup(group.id, view.snapshot.revision, new AbortController().signal);
      if (selectedGroupId === group.id) selectedGroupId = null;
      void controller?.refresh();
    } catch (cause) {
      mutationError = cause instanceof Error ? cause.message : "Could not delete the agent group.";
    } finally {
      mutationBusy = false;
    }
  }

  export function refresh() {
    if (isOwner) void controller?.refresh();
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      controller = undefined;
      return;
    }
    const next = createAgentGroupController((s) => { view = s; });
    controller = next;
    void next.refresh();
    return () => { next.dispose(); if (controller === next) controller = undefined; };
  });

  // Live transcript: poll only while a run is in flight.
  $effect(() => {
    if (!isOwner || !running) return;
    const timer = setInterval(() => { void controller?.poll(); }, 4000);
    return () => clearInterval(timer);
  });
</script>

<section aria-labelledby="agent-group-title" aria-busy={isOwner && busy} data-agent-group-state={stateTag}>
  <header class="feature-header">
    <div class="ag-row">
      <h2 id="agent-group-title">Agent Groups</h2>
      {#if isOwner && view.kind === "ready"}<code class="ag-rev">rev {view.snapshot.revision}</code>{/if}
    </div>
    {#if isOwner}
      <div class="actions">
        {#if view.kind === "ready"}
          <button type="button" onclick={() => { editorOpen = true; mutationError = ""; }}>New group</button>
        {/if}
        <button type="button" disabled={busy} onclick={refresh}>
          {view.kind === "loading" ? "Loading..." : "Refresh"}
        </button>
      </div>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect or run agent groups. Sign in from an Owner device to coordinate multi-agent discussions.
    </p>
  {:else if view.kind === "loading"}
    <p role="status">Loading agent groups...</p>
  {:else if view.kind === "error"}
    <p class="feedback error" role="alert">{view.message}</p>
  {:else}
    {#if view.notice}<p class="feedback ok" role="status">{view.notice}</p>{/if}
    {#if view.actionError}<p class="feedback error" role="alert">{view.actionError}</p>{/if}
    {#if mutationError}<p class="feedback error" role="alert">{mutationError}</p>{/if}

    {#if view.snapshot.groups.length === 0}
      <div class="ag-empty">
        <h3>Let your agents talk to each other</h3>
        <p>Group several Hermes profiles into one discussion. Each agent keeps its persona and replies in turn.</p>
        <button type="button" class="primary" onclick={() => { editorOpen = true; }}>Create the first group</button>
      </div>
    {:else}
      <div class="ag-field">
        <label for="ag-filter">Filter groups</label>
        <input id="ag-filter" type="search" bind:value={filterQuery} placeholder="Group name, member, profile, or status" />
      </div>

      {#if visibleGroups.length === 0}
        <p>No agent groups match "{filterQuery.trim()}".</p>
      {:else}
        <div class="ag-workspace">
          <AgentGroupSidebar groups={visibleGroups} {selectedGroupId} onselect={(id) => { selectedGroupId = id; }} />
          {#if selectedGroup}
            <AgentGroupRoom
              group={selectedGroup}
              run={activeRun}
              topic={topicInput}
              {busy}
              busyAction={view.busyAction}
              mutationBusy={mutationBusy}
              ontopic={(value) => { topicInput = value; }}
              onstart={handleStart}
              onstop={handleStop}
              onedit={() => { editorOpen = true; mutationError = ""; }}
              ondelete={() => void removeGroup(selectedGroup!)}
            />
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</section>

{#if editorOpen && view.kind === "ready"}
  <AgentGroupEditorDrawer
    group={selectedGroup}
    busy={mutationBusy}
    error={mutationError}
    onsubmit={(draft) => void saveGroup(draft)}
    onclose={() => { editorOpen = false; mutationError = ""; }}
  />
{/if}

<style>
  .ag-row { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; }
  .ag-rev { font-size: 0.75rem; color: var(--muted); padding: 0.125rem 0.375rem; border: 1px solid var(--border); border-radius: 0.25rem; }
  .ag-field { display: grid; gap: 0.375rem; margin: 0.75rem 0; }
  .ag-field label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .ag-field input { width: 100%; min-width: 0; }
  .ag-empty { display: grid; gap: 0.5rem; padding: 1rem; border: 1px solid var(--border); border-radius: 0.625rem; background: var(--surface); }
  .ag-empty h3 { margin: 0; }
  .ag-empty p { margin: 0; font-size: 0.875rem; }
  .ag-workspace { display: grid; grid-template-columns: minmax(13rem, 0.85fr) minmax(0, 1.9fr); gap: 0.75rem; align-items: start; }
  @media (max-width: 52rem) { .ag-workspace { grid-template-columns: 1fr; } }
</style>
