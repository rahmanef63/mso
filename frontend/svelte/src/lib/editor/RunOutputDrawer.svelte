<script lang="ts">
  import type { EditorExecResult } from "./editor-api.ts";

  let {
    open,
    running,
    command,
    result,
    canRun,
    onCommandChange,
    onRun,
    onClear,
    onToggle,
  }: {
    open: boolean;
    running: boolean;
    command: string;
    result: EditorExecResult | null;
    canRun: boolean;
    onCommandChange: (next: string) => void;
    onRun: () => void;
    onClear: () => void;
    onToggle: () => void;
  } = $props();

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    if (canRun && !running) onRun();
  }
</script>

<div class="run-drawer" data-run-drawer-open={String(open)}>
  <div class="run-header">
    <button
      type="button"
      class="drawer-toggle"
      aria-expanded={open}
      onclick={onToggle}
    >
      <span class="glyph" aria-hidden="true">{open ? "v" : ">"}</span>
      <span>Output Console</span>
    </button>

    {#if running}
      <span class="run-pill pending">Running...</span>
    {:else if result}
      <span class="run-pill" class:ok={result.ok} class:err={!result.ok}>
        {result.exitCode === null ? "Cancelled" : `Exit ${result.exitCode}`}
      </span>
      <span class="run-meta">{result.durationMs} ms</span>
    {/if}

    <div class="run-head-actions">
      <button type="button" class="small-btn" disabled={!result} onclick={onClear}>Clear</button>
    </div>
  </div>

  {#if open}
    <div class="run-body">
      <form class="run-cmd-row" onsubmit={handleSubmit}>
        <label class="sr-only" for="editor-run-cmd">Run command</label>
        <input
          id="editor-run-cmd"
          type="text"
          value={command}
          placeholder="Command to run (POST /api/v1/editor/exec)"
          disabled={running}
          autocomplete="off"
          spellcheck={false}
          oninput={(e) => onCommandChange((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="primary small-btn" disabled={!canRun || running}>
          {running ? "Running..." : "Run"}
        </button>
      </form>

      <div class="run-output" role="log" aria-live="polite">
        {#if !result && !running}
          <p class="run-empty">Click Run to execute the active file via /api/v1/editor/exec.</p>
        {:else if running}
          <p class="run-empty">Executing <code>{command || "active file"}</code>...</p>
        {:else if result}
          {#if result.error}
            <p class="run-error" role="alert">{result.error}</p>
          {/if}
          {#if result.stdout}
            <div class="stream-block">
              <div class="stream-label">stdout</div>
              <pre class="stream-pre">{result.stdout}</pre>
            </div>
          {/if}
          {#if result.stderr && result.stderr !== result.error}
            <div class="stream-block">
              <div class="stream-label err">stderr</div>
              <pre class="stream-pre err">{result.stderr}</pre>
            </div>
          {/if}
          {#if !result.stdout && !result.stderr && !result.error}
            <p class="run-empty">Process finished with no output (exit code {result.exitCode ?? 0}).</p>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .run-drawer { border-top: 1px solid var(--border); background: var(--panel); }
  .run-header {
    display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;
    padding: 0.3rem 0.55rem;
  }
  .drawer-toggle {
    min-height: 1.7rem; padding: 0.15rem 0.4rem; border: 0; background: transparent;
    color: var(--text); font-size: 0.78rem; font-weight: 600;
    display: inline-flex; align-items: center; gap: 0.35rem;
  }
  .glyph { font-family: var(--font-mono); color: var(--muted); }
  .run-pill {
    display: inline-flex; align-items: center; padding: 0.1rem 0.45rem; border-radius: 999px;
    font-size: 0.7rem; font-weight: 600; font-family: var(--font-mono);
    border: 1px solid var(--border);
  }
  .run-pill.ok { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .run-pill.err { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .run-pill.pending { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .run-meta { font-size: 0.72rem; color: var(--muted); font-family: var(--font-mono); }
  .run-head-actions { margin-left: auto; display: flex; gap: 0.25rem; }
  .small-btn { min-height: 1.75rem; padding: 0.15rem 0.55rem; font-size: 0.75rem; border-radius: 0.375rem; }
  .run-body {
    border-top: 1px solid var(--border); padding: 0.45rem 0.55rem;
    display: flex; flex-direction: column; gap: 0.45rem;
  }
  .run-cmd-row { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .run-cmd-row input {
    flex: 1 1 10rem; min-width: 0; min-height: 1.85rem; padding: 0.2rem 0.45rem;
    font-size: 0.78rem; font-family: var(--font-mono);
  }
  .run-output {
    max-height: 10.5rem; overflow: auto; border: 1px solid var(--border);
    border-radius: 0.375rem; background: var(--surface); padding: 0.45rem 0.55rem;
  }
  .run-empty { margin: 0; font-size: 0.78rem; color: var(--muted); }
  .run-error {
    margin: 0 0 0.4rem; padding: 0.35rem 0.5rem; border-radius: 0.375rem;
    background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger);
    font-size: 0.78rem;
  }
  .stream-block { margin-bottom: 0.4rem; }
  .stream-block:last-child { margin-bottom: 0; }
  .stream-label {
    font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--muted); margin-bottom: 0.15rem;
  }
  .stream-label.err { color: var(--danger); }
  .stream-pre {
    margin: 0; font-family: var(--font-mono); font-size: 0.78rem; line-height: 1.45;
    white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text);
  }
  .stream-pre.err { color: var(--danger); }
</style>
