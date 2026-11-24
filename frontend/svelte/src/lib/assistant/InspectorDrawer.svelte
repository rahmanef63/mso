<script lang="ts">
  import { BUILTIN_PLAYBOOKS } from "./assistant-presets";
  import type {
    AgentProfileSummary,
    AgentSessionSummary,
    AgentToolInfo,
    CockpitSnapshot,
    DrawerTab,
    EndpointStatus,
  } from "./assistant-types";
  import InspectorLists from "./InspectorLists.svelte";

  let {
    profiles,
    profilesStatus,
    profilesNote,
    activeProfileId,
    activePlaybookId,
    tools,
    toolsScope,
    toolsStatus,
    toolsNote,
    sessions,
    sessionsStatus,
    sessionsNote,
    cockpit,
    onSelectProfile,
    onSelectPlaybook,
    onPickStarter,
    onRefresh,
    onClose,
  }: {
    profiles: AgentProfileSummary[];
    profilesStatus: EndpointStatus;
    profilesNote: string | null;
    activeProfileId: string | null;
    activePlaybookId: string | null;
    tools: AgentToolInfo[];
    toolsScope: string;
    toolsStatus: EndpointStatus;
    toolsNote: string | null;
    sessions: AgentSessionSummary[];
    sessionsStatus: EndpointStatus;
    sessionsNote: string | null;
    cockpit: CockpitSnapshot | null;
    onSelectProfile: (id: string | null) => void;
    onSelectPlaybook: (id: string | null) => void;
    onPickStarter: (prompt: string) => void;
    onRefresh: () => void;
    onClose?: () => void;
  } = $props();

  let tab = $state<DrawerTab>("profiles");
</script>

<aside class="drawer-pane" aria-label="Agent profiles, playbooks, tools, and sessions">
  <div class="drawer-head">
    <h3>Cockpit Inspector</h3>
    <div class="drawer-head-actions">
      <button type="button" class="mini-btn" onclick={onRefresh}>Refresh</button>
      {#if onClose}
        <button type="button" class="mini-btn" onclick={onClose} aria-label="Close inspector">Close</button>
      {/if}
    </div>
  </div>

  {#if cockpit}
    <div class="cockpit-stats" aria-label="Host cockpit summary">
      <span class="stat-chip">Projects: {cockpit.projectCount}</span>
      <span class="stat-chip">Agents: {cockpit.localAgentCount}</span>
      <span class="stat-chip">Sessions: {cockpit.activeSessions}</span>
    </div>
  {/if}

  <div class="drawer-tabs" role="tablist" aria-label="Inspector sections">
    <button type="button" role="tab" class="tab-btn" aria-selected={tab === "profiles"} onclick={() => { tab = "profiles"; }}>
      Profiles ({profiles.length})
    </button>
    <button type="button" role="tab" class="tab-btn" aria-selected={tab === "playbooks"} onclick={() => { tab = "playbooks"; }}>
      Playbooks
    </button>
    <button type="button" role="tab" class="tab-btn" aria-selected={tab === "tools"} onclick={() => { tab = "tools"; }}>
      Tools ({tools.length})
    </button>
    <button type="button" role="tab" class="tab-btn" aria-selected={tab === "sessions"} onclick={() => { tab = "sessions"; }}>
      Sessions ({sessions.length})
    </button>
  </div>

  <div class="drawer-body" role="tabpanel">
    {#if tab === "profiles"}
      <button
        type="button"
        class="item-card selectable"
        class:selected={activeProfileId === null}
        onclick={() => onSelectProfile(null)}
      >
        <div class="item-top">
          <strong>Standard Alfa Chat</strong>
          <span class="badge">{activeProfileId === null ? "Active" : "Chat"}</span>
        </div>
        <p class="item-desc">Stream conversation directly with the selected host model.</p>
      </button>

      {#if profilesStatus === "loading" && profiles.length === 0}
        <p class="empty-msg" role="status">Loading saved agent profiles...</p>
      {:else if profiles.length === 0}
        <p class="empty-msg">{profilesNote ?? "No saved agent profiles on this host."}</p>
      {:else}
        {#each profiles as prof (prof.id)}
          <button
            type="button"
            class="item-card selectable"
            class:selected={activeProfileId === prof.id}
            disabled={!prof.enabled}
            onclick={() => onSelectProfile(prof.id)}
          >
            <div class="item-top">
              <strong>{prof.avatar ? `${prof.avatar} ` : ""}{prof.name}</strong>
              <span class="badge">r{prof.revision}{prof.isDefault ? " default" : ""}{!prof.enabled ? " disabled" : ""}</span>
            </div>
            <p class="item-meta">{prof.model.provider}/{prof.model.model} · {prof.tools.length} read tools</p>
            {#if prof.instructions}
              <p class="item-desc">{prof.instructions}</p>
            {/if}
          </button>
        {/each}
      {/if}
    {:else if tab === "playbooks"}
      {#each BUILTIN_PLAYBOOKS as pb (pb.id)}
        <div class="item-card" class:selected={activePlaybookId === pb.id}>
          <div class="item-top">
            <strong>{pb.name}</strong>
            <button
              type="button"
              class="mini-btn"
              class:primary={activePlaybookId === pb.id}
              onclick={() => onSelectPlaybook(activePlaybookId === pb.id ? null : pb.id)}
            >
              {activePlaybookId === pb.id ? "Active" : "Use"}
            </button>
          </div>
          <p class="item-desc">{pb.summary}</p>
          <div class="starter-list">
            {#each pb.starters as starter (starter)}
              <button type="button" class="starter-chip" onclick={() => onPickStarter(starter)}>
                {starter}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    {:else}
      <InspectorLists
        mode={tab}
        {tools}
        {toolsScope}
        {toolsStatus}
        {toolsNote}
        {sessions}
        {sessionsStatus}
        {sessionsNote}
      />
    {/if}
  </div>
</aside>

<style>
  .drawer-pane {
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    gap: 0.5rem;
    padding: 0.65rem;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    background: var(--surface);
    min-width: 0;
    max-width: 100%;
    max-height: 36rem;
  }
  .drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap; }
  .drawer-head-actions { display: inline-flex; gap: 0.3rem; }
  .cockpit-stats { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .stat-chip, .badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.1rem 0.42rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--muted);
  }
  .drawer-tabs { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .tab-btn { min-height: 2rem; padding: 0.2rem 0.5rem; font-size: 0.75rem; flex: 1 1 auto; }
  .tab-btn[aria-selected="true"] {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
    font-weight: 600;
  }
  .drawer-body { display: grid; align-content: start; gap: 0.45rem; overflow-y: auto; min-width: 0; }
  .item-card {
    display: grid;
    gap: 0.25rem;
    padding: 0.55rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--panel-solid);
    color: var(--text);
    text-align: left;
    min-width: 0;
    max-width: 100%;
  }
  .item-card.selectable { cursor: pointer; width: 100%; }
  .item-card.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, var(--panel-solid));
  }
  .item-top { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap; }
  .item-top strong { font-size: 0.83rem; color: var(--text); overflow-wrap: anywhere; }
  .item-meta, .item-desc, .empty-msg { margin: 0; font-size: 0.76rem; color: var(--muted); overflow-wrap: anywhere; }
  .starter-list { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.15rem; }
  .starter-chip { min-height: 1.85rem; padding: 0.2rem 0.45rem; font-size: 0.73rem; text-align: left; white-space: normal; }
  .mini-btn { min-height: 1.9rem; padding: 0.18rem 0.5rem; font-size: 0.75rem; }
</style>
