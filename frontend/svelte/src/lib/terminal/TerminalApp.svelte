<script lang="ts">
  import { onMount } from "svelte";
  import { createTerminalController, initialTerminalState, type TerminalState } from "./term-controller";

  let {
    initialCwd,
    autoConnect = true,
  }: {
    initialCwd?: string;
    autoConnect?: boolean;
  } = $props();

  let view = $state<TerminalState>(initialTerminalState());
  let command = $state("");
  let outputEl = $state<HTMLPreElement | undefined>(undefined);
  let controller: ReturnType<typeof createTerminalController> | undefined;

  let isActive = $derived(view.status === "connected" || view.status === "connecting");
  let statusLabel = $derived.by(() => {
    if (view.status === "connected") return "Connected";
    if (view.status === "connecting") return "Connecting";
    if (view.status === "error") return "Error";
    if (view.status === "closed") {
      return view.exitCode !== null ? `Closed (${view.exitCode})` : "Closed";
    }
    return "Idle";
  });

  $effect(() => {
    void view.output;
    if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
  });

  onMount(() => {
    controller = createTerminalController((next) => {
      view = next;
    });
    if (autoConnect) void controller.connect(initialCwd);
    return () => controller?.dispose();
  });

  function submitCommand(event: SubmitEvent) {
    event.preventDefault();
    if (view.status !== "connected" || view.sending) return;
    const text = command;
    command = "";
    void controller?.sendLine(text);
  }
</script>

<section
  class="terminal-shell"
  aria-labelledby="terminal-title"
  aria-busy={view.status === "connecting"}
  data-terminal-state={view.status}
>
  <header class="feature-header">
    <div class="term-heading">
      <h2 id="terminal-title">Terminal</h2>
      <span class={`status-pill status-${view.status}`} role="status" aria-live="polite">
        {statusLabel}
      </span>
    </div>
    <div class="actions">
      <button type="button" disabled={!view.output} onclick={() => controller?.clearOutput()}>
        Clear
      </button>
      <button
        type="button"
        disabled={view.status !== "connected" || view.sending}
        onclick={() => void controller?.sendRaw("\x03")}
      >
        Ctrl+C
      </button>
      {#if isActive}
        <button type="button" class="danger" onclick={() => void controller?.disconnect()}>
          Disconnect
        </button>
      {:else}
        <button type="button" class="primary" onclick={() => void controller?.connect(initialCwd)}>
          Reconnect
        </button>
      {/if}
    </div>
  </header>

  {#if view.error}
    <div class="feedback error" role="alert">
      <p>{view.error}</p>
      {#if view.errorStatus === 403}
        <p class="error-hint">
          Terminal access requires an Owner session. Switch or approve an Owner device in Devices to use the host shell.
        </p>
      {/if}
    </div>
  {/if}

  <pre
    bind:this={outputEl}
    class="term-output"
    role="log"
    aria-live="polite"
    aria-label="Terminal output"
  >{view.output || (view.status === "connecting" ? "Connecting to host terminal..." : "No terminal output yet.")}</pre>

  <form class="term-input-form" onsubmit={submitCommand}>
    <label for="term-cmd" class="sr-only">Terminal command</label>
    <input
      id="term-cmd"
      class="term-cmd"
      type="text"
      bind:value={command}
      placeholder={view.status === "connected" ? "Enter command and press Enter" : "Connect to send commands"}
      disabled={view.status !== "connected" || view.sending}
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
    />
    <button type="submit" class="primary" disabled={view.status !== "connected" || view.sending}>
      {view.sending ? "Sending..." : "Send"}
    </button>
  </form>
</section>

<style>
  .terminal-shell { display: grid; gap: 0.875rem; min-width: 0; max-width: 100%; }
  .term-heading { display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap; min-width: 0; }
  .status-pill {
    display: inline-flex; align-items: center; padding: 0.125rem 0.625rem;
    border-radius: 999px; border: 1px solid var(--border); font-size: 0.75rem; font-weight: 600;
    color: var(--muted); background: var(--surface);
  }
  .status-connected { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .status-connecting { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .status-error { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .feedback p { margin: 0; color: inherit; }
  .error-hint { margin-top: 0.375rem; font-size: 0.875rem; }
  .term-output {
    margin: 0; padding: 0.875rem; min-height: 12rem; max-height: 24rem; width: 100%; max-width: 100%;
    overflow-y: auto; overflow-x: hidden; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--surface); color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  }
  .term-input-form { display: flex; flex-wrap: wrap; gap: 0.5rem; width: 100%; max-width: 100%; }
  .term-cmd {
    flex: 1 1 11rem; min-width: 0; max-width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .term-input-form button { flex: 0 0 auto; }
</style>
