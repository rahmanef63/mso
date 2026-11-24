<script lang="ts">
  import "./TerminalPane.css";
  // One PTY pane: owns the controller, scrollback search state and the resize
  // loop. Panes stay mounted while hidden so switching tabs never kills a
  // shell; the PTY opens on first activation to save host slots.
  import { onMount } from "svelte";
  import { createTerminalController, initialTerminalState, type TerminalState } from "./term-controller";
  import { gridEquals, measureCell, measureGrid, type Grid } from "./term-metrics";
  import { findMatches, stepMatch } from "./term-search";
  import { parseAnsiRuns, runsText } from "./term-ansi";
  import { statusLabel, tabStatus, type TabStatus } from "./term-tabs";
  import TerminalOutput from "./TerminalOutput.svelte";
  import TerminalToolbar from "./TerminalToolbar.svelte";
  import TerminalKeyBar from "./TerminalKeyBar.svelte";
  import TerminalPrompt from "./TerminalPrompt.svelte";

  let {
    tabId,
    initialCwd,
    initialCommand,
    autoConnect = true,
    active,
    onstatus,
  }: {
    tabId: number;
    initialCwd?: string;
    initialCommand?: string;
    autoConnect?: boolean;
    active: boolean;
    onstatus: (id: number, status: TabStatus) => void;
  } = $props();

  const MIN_FONT = 10;
  const MAX_FONT = 22;
  const COPY_FEEDBACK_MS = 1600;

  let view = $state<TerminalState>(initialTerminalState());
  let draft = $state("");
  let fontSize = $state(13);
  let query = $state("");
  let activeMatch = $state(-1);
  let copied = $state(false);
  let hostEl = $state<HTMLDivElement | undefined>(undefined);
  let outputEl = $state<HTMLPreElement | undefined>(undefined);
  let inputEl = $state<HTMLInputElement | undefined>(undefined);

  let controller: ReturnType<typeof createTerminalController> | undefined;
  let grid: Grid = { cols: 80, rows: 24 };
  let started = false;
  let presetSent = false;

  let status = $derived(tabStatus(view.status));
  let plainText = $derived(runsText(parseAnsiRuns(view.output)));
  let matches = $derived(findMatches(plainText, query));
  let canType = $derived(view.status === "connected" && !view.sending);
  let statusText = $derived.by(() => {
    if (view.status === "closed" && view.exitCode !== null) return `Closed (${view.exitCode})`;
    return statusLabel(status);
  });

  function onSearch(next: string) {
    query = next;
    activeMatch = next.trim() && matches.length ? 0 : -1;
  }

  function setFont(delta: -1 | 1) {
    fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, fontSize + delta));
  }

  function setMatch(delta: -1 | 1) {
    activeMatch = stepMatch(activeMatch, matches.length, delta);
  }

  async function copyScrollback() {
    if (!plainText) return;
    try {
      await navigator.clipboard.writeText(plainText);
      copied = true;
      window.setTimeout(() => (copied = false), COPY_FEEDBACK_MS);
    } catch {
      copied = false;
    }
  }

  function insertSnippet(text: string) {
    draft = text;
    inputEl?.focus();
  }

  function syncGrid() {
    if (!hostEl || !controller) return;
    const rect = hostEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const next = measureGrid(rect.width, rect.height, measureCell(hostEl));
    controller.setSize(next.cols, next.rows);
    if (gridEquals(next, grid)) return;
    grid = next;
    void controller.resize(next.cols, next.rows);
  }

  $effect(() => {
    void view.output;
    void activeMatch;
    if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
  });

  $effect(() => {
    onstatus(tabId, status);
  });

  // Preset command (for example an agent CLI) runs once, after the shell is live.
  $effect(() => {
    if (presetSent || !initialCommand || view.status !== "connected") return;
    presetSent = true;
    void controller?.sendLine(initialCommand);
  });

  onMount(() => {
    controller = createTerminalController((next) => { view = next; }, { preserveSgr: true });
    let timer = 0;
    const schedule = () => {
      if (typeof requestAnimationFrame === "function") {
        cancelAnimationFrame(timer);
        timer = requestAnimationFrame(syncGrid);
      } else {
        window.clearTimeout(timer);
        timer = window.setTimeout(syncGrid, 60);
      }
    };
    const observer = new ResizeObserver(schedule);
    if (hostEl) observer.observe(hostEl);
    syncGrid();
    if (active && autoConnect) {
      started = true;
      void controller.connect(initialCwd);
    }
    return () => {
      observer.disconnect();
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(timer);
      else window.clearTimeout(timer);
      controller?.dispose();
    };
  });

  // Lazy start: a tab that is created but never opened does not consume a PTY.
  $effect(() => {
    if (active && !started && autoConnect) {
      started = true;
      void controller?.connect(initialCwd);
    }
  });
</script>

<div class="pane" class:hidden={!active} aria-hidden={!active}>
  <header class="pane-head">
    <span class={`pill pill-${status}`} role="status" aria-live="polite">{statusText}</span>
    {#if view.status === "connected" || view.status === "connecting"}
      <button type="button" onclick={() => void controller?.disconnect()}>Disconnect</button>
    {:else}
      <button type="button" class="primary" onclick={() => void controller?.connect(initialCwd)}>Reconnect</button>
    {/if}
    <span class="copied" role="status" aria-live="polite">{copied ? "Copied scrollback" : ""}</span>
  </header>

  {#if view.error}
    <div class="feedback error" role="alert">
      <p>{view.error}</p>
      {#if view.errorStatus === 403}
        <p class="hint">Terminal access requires an Owner session. Switch or approve an Owner device in Devices to use the host shell.</p>
      {/if}
    </div>
  {/if}

  <TerminalToolbar
    matchCount={matches.length}
    {activeMatch}
    canClear={Boolean(view.output)}
    canCopy={Boolean(plainText)}
    {canType}
    {fontSize}
    onsearch={onSearch}
    onstep={setMatch}
    onclear={() => controller?.clearOutput()}
    oncopy={() => void copyScrollback()}
    onfontstep={setFont}
    onsnippet={insertSnippet}
  />

  <div class="stage" bind:this={hostEl}>
    <TerminalOutput
      text={view.output}
      {query}
      {activeMatch}
      {fontSize}
      bind:outputEl
      placeholder={view.status === "connecting" ? "Connecting to host terminal..." : "No terminal output yet."}
    />
  </div>

  <TerminalPrompt
    {tabId}
    {canType}
    sending={view.sending}
    bind:draft
    bind:inputEl
    onsubmit={(text) => void controller?.sendLine(text)}
    oninterrupt={() => void controller?.sendRaw("\x03")}
    onclear={() => void controller?.sendRaw("\x0c")}
  />

  <TerminalKeyBar disabled={!canType} onpress={(seq) => void controller?.sendRaw(seq)} />
</div>
