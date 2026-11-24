<script lang="ts">
  let {
    pathInput,
    loading,
    explorerOpen,
    wordWrap,
    barMode,
    isMarkdown,
    showPreview,
    canRun,
    running,
    consoleOpen,
    onPathInput,
    onOpenSubmit,
    onToggleExplorer,
    onToggleWrap,
    onDecreaseFont,
    onIncreaseFont,
    onToggleFind,
    onToggleGoto,
    onTogglePreview,
    onRun,
    onToggleConsole,
  }: {
    pathInput: string;
    loading: boolean;
    explorerOpen: boolean;
    wordWrap: boolean;
    barMode: "find" | "goto" | null;
    isMarkdown: boolean;
    showPreview: boolean;
    canRun: boolean;
    running: boolean;
    consoleOpen: boolean;
    onPathInput: (value: string) => void;
    onOpenSubmit: () => void;
    onToggleExplorer: () => void;
    onToggleWrap: () => void;
    onDecreaseFont: () => void;
    onIncreaseFont: () => void;
    onToggleFind: () => void;
    onToggleGoto: () => void;
    onTogglePreview: () => void;
    onRun: () => void;
    onToggleConsole: () => void;
  } = $props();

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    onOpenSubmit();
  }
</script>

<header class="ide-toolbar">
  <div class="toolbar-brand">
    <button type="button" class="tb-btn" aria-pressed={explorerOpen} onclick={onToggleExplorer}>
      Explorer
    </button>
    <h2 id="editor-title">Code Editor</h2>
  </div>

  <form class="path-form" onsubmit={handleSubmit} novalidate>
    <label class="sr-only" for="editor-path-input">File path</label>
    <input
      id="editor-path-input"
      type="text"
      value={pathInput}
      placeholder="~/path/to/file.ts"
      disabled={loading}
      autocomplete="off"
      spellcheck={false}
      oninput={(e) => onPathInput((e.currentTarget as HTMLInputElement).value)}
    />
    <button type="submit" class="primary tb-btn" disabled={loading}>Open</button>
  </form>

  <div class="toolbar-tools" role="toolbar" aria-label="Editor actions">
    <button type="button" class="tb-btn" class:active={wordWrap} aria-pressed={wordWrap} onclick={onToggleWrap}>Wrap</button>
    <button type="button" class="tb-btn" aria-label="Decrease font size" onclick={onDecreaseFont}>A-</button>
    <button type="button" class="tb-btn" aria-label="Increase font size" onclick={onIncreaseFont}>A+</button>
    <button type="button" class="tb-btn" class:active={barMode === "find"} onclick={onToggleFind}>Find</button>
    <button type="button" class="tb-btn" class:active={barMode === "goto"} onclick={onToggleGoto}>Line</button>
    {#if isMarkdown}
      <button type="button" class="tb-btn" class:active={showPreview} aria-pressed={showPreview} onclick={onTogglePreview}>Preview</button>
    {/if}
    <button type="button" class="tb-btn" disabled={!canRun || running} onclick={onRun}>Run</button>
    <button type="button" class="tb-btn" class:active={consoleOpen} aria-pressed={consoleOpen} onclick={onToggleConsole}>Console</button>
  </div>
</header>

<style>
  .ide-toolbar {
    display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;
    padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); background: var(--panel);
  }
  .toolbar-brand { display: inline-flex; align-items: center; gap: 0.45rem; }
  .toolbar-brand h2 { font-size: 0.92rem; white-space: nowrap; }
  .path-form { display: flex; align-items: center; gap: 0.35rem; flex: 1 1 12rem; min-width: 0; }
  .path-form input {
    flex: 1 1 8rem; min-width: 0; min-height: 1.95rem; padding: 0.2rem 0.45rem;
    font-family: var(--font-mono); font-size: 0.8rem;
  }
  .toolbar-tools { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
  .tb-btn { min-height: 1.95rem; padding: 0.2rem 0.5rem; font-size: 0.76rem; border-radius: 0.375rem; }
  .tb-btn.active { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
</style>
