<script lang="ts">
  import { formatRelativeTime } from "./assistant-presets";
  import type { AgentSessionSummary, AgentToolInfo, EndpointStatus } from "./assistant-types";

  let {
    mode,
    tools,
    toolsScope,
    toolsStatus,
    toolsNote,
    sessions,
    sessionsStatus,
    sessionsNote,
  }: {
    mode: "tools" | "sessions";
    tools: AgentToolInfo[];
    toolsScope: string;
    toolsStatus: EndpointStatus;
    toolsNote: string | null;
    sessions: AgentSessionSummary[];
    sessionsStatus: EndpointStatus;
    sessionsNote: string | null;
  } = $props();

  let toolQuery = $state("");

  let filteredTools = $derived.by(() => {
    const q = toolQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  });
</script>

{#if mode === "tools"}
  <div class="tools-bar">
    <label class="sr-only" for="assistant-tool-filter">Filter tools</label>
    <input id="assistant-tool-filter" type="search" bind:value={toolQuery} placeholder="Filter host tools..." />
    {#if toolsScope}
      <span class="badge">Scope: {toolsScope}</span>
    {/if}
  </div>
  {#if toolsStatus === "loading" && tools.length === 0}
    <p class="empty-msg" role="status">Loading host tools...</p>
  {:else if filteredTools.length === 0}
    <p class="empty-msg">{toolsNote ?? "No matching host tools."}</p>
  {:else}
    {#each filteredTools as tool (tool.name)}
      <div class="item-card">
        <div class="item-top">
          <code class="tool-name">{tool.name}</code>
          <span class="badge" class:warn-badge={tool.approvalRequired}>
            {tool.approvalRequired ? "Approval" : tool.scope}
          </span>
        </div>
        {#if tool.description}
          <p class="item-desc">{tool.description}</p>
        {/if}
      </div>
    {/each}
  {/if}
{:else if sessionsStatus === "loading" && sessions.length === 0}
  <p class="empty-msg" role="status">Loading agent sessions...</p>
{:else if sessions.length === 0}
  <p class="empty-msg">{sessionsNote ?? "No recorded agent sessions yet."}</p>
{:else}
  {#each sessions as sess (sess.id)}
    <div class="item-card">
      <div class="item-top">
        <strong>{sess.title || sess.name || sess.id}</strong>
        {#if sess.source}
          <span class="badge">{sess.source}</span>
        {/if}
      </div>
      <p class="item-meta">
        {#if sess.eventCount !== undefined}{sess.eventCount} events{/if}
        {#if sess.estimatedTokens !== undefined} · ~{sess.estimatedTokens} tok{/if}
        {#if sess.updatedAt} · {formatRelativeTime(sess.updatedAt)}{/if}
      </p>
      {#if sess.cwd}
        <p class="item-path">{sess.cwd}</p>
      {/if}
    </div>
  {/each}
{/if}

<style>
  .tools-bar { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .tools-bar input { flex: 1 1 8rem; min-width: 0; min-height: 2.1rem; font-size: 0.8rem; }
  .badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.1rem 0.42rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--muted);
  }
  .warn-badge { border-color: var(--warn); background: var(--warn-bg); color: var(--warn); }
  .item-card {
    display: grid;
    gap: 0.25rem;
    padding: 0.55rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--panel-solid);
    color: var(--text);
    min-width: 0;
    max-width: 100%;
  }
  .item-top { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap; }
  .item-top strong { font-size: 0.83rem; color: var(--text); overflow-wrap: anywhere; }
  .item-meta, .item-desc, .empty-msg {
    margin: 0;
    font-size: 0.76rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .item-path, .tool-name {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    color: var(--text);
    overflow-wrap: anywhere;
  }
</style>
