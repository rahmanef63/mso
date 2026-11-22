<script lang="ts">
  import {
    createAgentGroupController,
    type AgentGroupRun,
    type AgentGroupRunState,
    type AgentGroupView,
    type AgentGroupViewState,
  } from "./agent-group-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<AgentGroupViewState>({ kind: "loading" });
  let filterQuery = $state("");
  let selectedGroupId = $state<string | null>(null);
  let promptInput = $state("");
  let controller: ReturnType<typeof createAgentGroupController> | undefined;

  let isOwner = $derived(role === "owner");
  let visibleGroups = $derived.by<AgentGroupView[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.snapshot.groups;
    return view.snapshot.groups.filter((g) =>
      `${g.name} ${g.id} ${g.enabled ? "enabled" : "disabled"} ${g.members.map((m) => `${m.name} ${m.profile}`).join(" ")} ${g.runs[0]?.state ?? ""}`
        .toLowerCase().includes(q));
  });

  let selectedGroup = $derived.by<AgentGroupView | null>(() => {
    if (view.kind !== "ready") return null;
    if (selectedGroupId) {
      const exact = view.snapshot.groups.find((g) => g.id === selectedGroupId);
      if (exact) return exact;
    }
    return visibleGroups[0] ?? null;
  });

  let activeRun = $derived.by<AgentGroupRun | null>(() => {
    if (!selectedGroup || selectedGroup.runs.length === 0) return null;
    return selectedGroup.runs.find((r) => r.state === "running") ?? selectedGroup.runs[0] ?? null;
  });

  let busy = $derived(view.kind === "loading" || (view.kind === "ready" && view.busyAction !== null));
  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.snapshot.groups.length === 0) return "empty";
    return visibleGroups.length === 0 ? "no-filter-matches" : "ready";
  });

  function runTone(runState: AgentGroupRunState): "ok" | "warn" | "danger" | "neutral" {
    if (runState === "completed") return "ok";
    if (runState === "running") return "warn";
    return runState === "failed" ? "danger" : "neutral";
  }

  function handleStartRun(event: Event) {
    event.preventDefault();
    if (!isOwner || !selectedGroup || !promptInput.trim() || busy) return;
    const text = promptInput.trim();
    promptInput = "";
    void controller?.startRun(selectedGroup.id, text);
  }

  function handleStopRun(runId: string) {
    if (isOwner && !busy) void controller?.stopRun(runId);
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
</script>

<section aria-labelledby="agent-group-title" aria-busy={isOwner && busy} data-agent-group-state={stateTag}>
  <header class="feature-header">
    <div class="ag-row">
      <h2 id="agent-group-title">Agent Groups</h2>
      {#if isOwner && view.kind === "ready"}<code class="ag-rev">rev {view.snapshot.revision}</code>{/if}
    </div>
    {#if isOwner}
      <button type="button" disabled={busy} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
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

    <div class="ag-field">
      <label for="ag-filter">Filter groups</label>
      <input id="ag-filter" type="search" bind:value={filterQuery} placeholder="Group name, member name, profile, or status" />
    </div>

    {#if view.snapshot.groups.length === 0}
      <p>No agent groups are configured yet.</p>
    {:else if visibleGroups.length === 0}
      <p>No agent groups match "{filterQuery.trim()}".</p>
    {:else}
      <div class="ag-layout">
        <ul class="ag-list" aria-label="Agent groups">
          {#each visibleGroups as group (group.id)}
            {@const latest = group.runs[0]}
            <li>
              <button type="button" class="ag-group-btn" class:selected={selectedGroup?.id === group.id} aria-pressed={selectedGroup?.id === group.id} onclick={() => { selectedGroupId = group.id; }}>
                <div class="ag-row">
                  <strong>{group.name}</strong>
                  <span class="pill" data-tone={group.enabled ? "ok" : "neutral"}>{group.enabled ? "enabled" : "disabled"}</span>
                  {#if latest}<span class="pill" data-tone={runTone(latest.state)}>{latest.state}</span>{/if}
                </div>
                <div class="ag-row">
                  {#each group.members as member (member.id)}
                    <span class="pill">{member.name} ({member.profile})</span>
                  {/each}
                </div>
              </button>
            </li>
          {/each}
        </ul>

        {#if selectedGroup}
          <div class="ag-detail" aria-label="Selected agent group">
            <div class="ag-row">
              <h3>{selectedGroup.name}</h3>
              <span class="pill">max {selectedGroup.maxRounds} {selectedGroup.maxRounds === 1 ? "round" : "rounds"}</span>
            </div>
            <div class="ag-row">
              {#each selectedGroup.members as member (member.id)}
                <span class="pill">{member.name}: {member.profile}</span>
              {/each}
            </div>

            {#if activeRun}
              <div class="ag-run-box" aria-label="Latest run status">
                <div class="ag-row">
                  <span class="pill" data-tone={runTone(activeRun.state)}>{activeRun.state}</span>
                  <span class="ag-meta">{activeRun.turns.length} {activeRun.turns.length === 1 ? "turn" : "turns"}</span>
                  {#if activeRun.state === "running"}
                    <button type="button" class="danger" disabled={busy} onclick={() => handleStopRun(activeRun.id)}>
                      {view.busyAction === "stop" ? "Stopping..." : "Stop"}
                    </button>
                  {/if}
                </div>
                <p class="ag-meta">Prompt: {activeRun.prompt}</p>
                {#if activeRun.error}<p class="ag-err">Error: {activeRun.error}</p>{/if}
              </div>
            {:else}
              <p class="ag-meta">No runs recorded for this group yet.</p>
            {/if}

            <form class="ag-field" onsubmit={handleStartRun}>
              <label for="ag-prompt">Start a discussion run</label>
              <textarea id="ag-prompt" rows="3" bind:value={promptInput} disabled={!selectedGroup.enabled || busy} placeholder={selectedGroup.enabled ? "Enter a topic or prompt for this group" : "This group is disabled"}></textarea>
              <button type="submit" class="primary" disabled={!selectedGroup.enabled || busy || !promptInput.trim()}>
                {view.busyAction === "run" ? "Starting..." : "Start Run"}
              </button>
            </form>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .ag-row { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .ag-rev { font-size: 0.75rem; color: var(--muted); padding: 0.125rem 0.375rem; border: 1px solid var(--border); border-radius: 0.25rem; }
  .ag-field { display: grid; gap: 0.375rem; margin: 0.75rem 0; }
  .ag-field label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .ag-field input, .ag-field textarea { width: 100%; min-width: 0; }
  .ag-layout { display: grid; grid-template-columns: minmax(14rem, 1fr) minmax(16rem, 1.2fr); gap: 0.75rem; align-items: start; }
  @media (max-width: 44rem) { .ag-layout { grid-template-columns: 1fr; } }
  .ag-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem; max-height: 24rem; overflow-y: auto; }
  .ag-group-btn { width: 100%; display: grid; gap: 0.375rem; text-align: left; }
  .ag-group-btn.selected { border-color: var(--accent); background: var(--surface); }
  .ag-detail { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); display: grid; gap: 0.5rem; }
  .ag-run-box { padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel); display: grid; gap: 0.375rem; }
  .ag-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .ag-err { margin: 0; font-size: 0.8125rem; color: var(--danger); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
