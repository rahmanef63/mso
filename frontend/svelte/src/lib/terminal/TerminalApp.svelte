<script lang="ts">
  // Terminal workspace: multi-tab PTY sessions. Each pane keeps its own
  // controller and scrollback, so switching tabs never restarts a shell.
  import { addTab, closeTab, createTab, renameTab, statusLabel, MAX_TABS, type Tab, type TabStatus } from "./term-tabs";
  import TerminalTabs from "./TerminalTabs.svelte";
  import TerminalPane from "./TerminalPane.svelte";

  let {
    initialCwd,
    initialCommand,
    autoConnect = true,
    tabbed = true,
  }: {
    initialCwd?: string;
    initialCommand?: string;
    autoConnect?: boolean;
    /** Set false for single-purpose shells such as an embedded agent console. */
    tabbed?: boolean;
  } = $props();

  let tabs = $state<Tab[]>([createTab(1)]);
  let activeId = $state(1);
  let statuses = $state<Record<number, TabStatus>>({});

  let activeStatus = $derived(statusLabel(statuses[activeId] ?? "disconnected"));

  function add() {
    const next = addTab(tabs);
    if (next.activeId === null) return;
    tabs = next.tabs;
    activeId = next.activeId;
  }

  function close(id: number) {
    const next = closeTab(tabs, id);
    tabs = next.tabs;
    if (next.activeId !== null) activeId = next.activeId;
    const { [id]: _dropped, ...rest } = statuses;
    statuses = rest;
  }

  function rename(id: number, title: string) {
    tabs = renameTab(tabs, id, title);
  }

  function setStatus(id: number, status: TabStatus) {
    if (statuses[id] === status) return;
    statuses = { ...statuses, [id]: status };
  }
</script>

<section
  class="terminal-shell"
  aria-labelledby="terminal-title"
  data-terminal-state={statuses[activeId] ?? "disconnected"}
>
  <header class="feature-header">
    <div class="term-heading">
      <h2 id="terminal-title">Terminal</h2>
      <span class="status-pill" role="status" aria-live="polite">{activeStatus}</span>
      <span class="tab-count">{tabs.length} / {MAX_TABS} tabs</span>
    </div>
  </header>

  {#if tabbed}
    <TerminalTabs {tabs} {activeId} {statuses} onselect={(id) => (activeId = id)} onadd={add} onclose={close} onrename={rename} />
  {/if}

  <div class="panes">
    {#each tabs as tab (tab.id)}
      {#if tabbed || tab.id === activeId}
        <TerminalPane
          tabId={tab.id}
          initialCwd={tab.cwd ?? initialCwd}
          {autoConnect}
          initialCommand={tab.id === 1 ? initialCommand : undefined}
          active={tab.id === activeId}
          onstatus={setStatus}
        />
      {/if}
    {/each}
  </div>
</section>

<style>
  .terminal-shell { display: flex; flex-direction: column; gap: 0.625rem; min-width: 0; max-width: 100%; height: 100%; min-height: 0; }
  .term-heading { display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap; min-width: 0; }
  .tab-count { font-size: 0.75rem; color: var(--muted); }
  .panes { flex: 1 1 auto; min-height: 0; min-width: 0; }
  @media (max-width: 480px) {
    .term-heading h2 { font-size: 1rem; }
  }
</style>
