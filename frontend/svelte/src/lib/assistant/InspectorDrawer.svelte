<script lang="ts">
  import "./InspectorDrawer.css";
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
