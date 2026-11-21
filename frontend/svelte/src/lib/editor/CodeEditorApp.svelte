<script lang="ts">
  import { onMount } from "svelte";
  import { countStats, createEditorController, type EditorState } from "./editor-api.ts";

  let { initialPath = "", onDirtyChange }: { initialPath?: string; onDirtyChange?: (dirty: boolean) => void } = $props();

  let view = $state<EditorState>({ kind: "idle" });
  let pathInput = $state("");
  let gutterEl = $state<HTMLPreElement | undefined>(undefined);
  let controller: ReturnType<typeof createEditorController> | undefined;

  let stats = $derived(view.kind === "ready" ? countStats(view.content) : { lines: 0, chars: 0, bytes: 0 });
  let lineNumbers = $derived(Array.from({ length: Math.max(1, stats.lines) }, (_, i) => i + 1).join("\n"));

  export function open(path: string) {
    pathInput = path;
    return controller?.open(path);
  }

  function handleOpenSubmit(event: SubmitEvent) {
    event.preventDefault();
    void controller?.open(pathInput);
  }

  function handleEditorInput(event: Event) {
    controller?.updateContent((event.currentTarget as HTMLTextAreaElement).value);
  }

  function handleScroll(event: Event) {
    if (gutterEl) gutterEl.scrollTop = (event.currentTarget as HTMLTextAreaElement).scrollTop;
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (view.kind === "ready" && view.dirty && !view.saving) void controller?.save();
    }
  }

  onMount(() => {
    controller = createEditorController(
      (next) => {
        view = next;
        if (next.kind === "ready") pathInput = next.path;
      },
      { onDirtyChange: (dirty) => onDirtyChange?.(dirty) },
    );
    const trimmed = initialPath.trim();
    if (trimmed) {
      pathInput = trimmed;
      void controller.open(trimmed);
    }
    return () => controller?.dispose();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  aria-labelledby="editor-title"
  aria-busy={view.kind === "loading" || (view.kind === "ready" && view.saving)}
  data-editor-state={view.kind}
  data-editor-dirty={view.kind === "ready" ? String(view.dirty) : "false"}
  onkeydown={handleKeydown}
>
  <header class="feature-header">
    <h2 id="editor-title">Code Editor</h2>
    <div class="editor-badges" aria-label="Buffer status">
      {#if view.kind === "ready"}
        <span class="role-badge">{view.language}</span>
        <span class="role-badge">{stats.lines} lines</span>
        <span class="role-badge">{stats.chars} chars</span>
        <span class="role-badge">{stats.bytes} B</span>
        {#if view.dirty}
          <span class="role-badge unsaved-badge">Unsaved changes</span>
        {/if}
      {/if}
    </div>
  </header>

  <form class="path-bar" onsubmit={handleOpenSubmit} novalidate>
    <label class="sr-only" for="editor-path-input">File path</label>
    <input
      id="editor-path-input"
      type="text"
      bind:value={pathInput}
      placeholder="~/path/to/file.ts"
      disabled={view.kind === "loading"}
      autocomplete="off"
      spellcheck={false}
    />
    <button type="submit" class="primary" disabled={view.kind === "loading"}>
      {view.kind === "loading" ? "Opening..." : "Open"}
    </button>
    {#if view.kind === "ready"}
      <button
        type="button"
        class="primary"
        disabled={!view.dirty || view.saving}
        onclick={() => void controller?.save()}
        title="Save file (Ctrl+S or Cmd+S)"
      >
        {view.saving ? "Saving..." : "Save"}
      </button>
      <button type="button" disabled={!view.dirty || view.saving} onclick={() => controller?.revert()}>
        Revert
      </button>
    {/if}
  </form>

  <div role="status" aria-live="polite">
    {#if view.kind === "idle"}
      <p class="editor-empty">Enter a file path above and select Open to view or edit a text file.</p>
    {:else if view.kind === "loading"}
      <p>Opening <code>{view.path}</code>...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if view.notice}<p class="feedback ok">{view.notice}</p>{/if}
      {#if view.actionError}<p class="feedback error" role="alert">{view.actionError}</p>{/if}

      <div class="editor-surface">
        <pre class="editor-gutter" aria-hidden="true" bind:this={gutterEl}>{lineNumbers}</pre>
        <label class="sr-only" for="editor-textarea">Editor contents for {view.path}</label>
        <textarea
          id="editor-textarea"
          class="editor-textarea"
          value={view.content}
          disabled={view.saving}
          wrap="off"
          spellcheck={false}
          aria-label={`Code buffer for ${view.path}`}
          oninput={handleEditorInput}
          onscroll={handleScroll}
        ></textarea>
      </div>
      <p class="editor-hint">Shortcut: press Ctrl+S or Cmd+S to save changes.</p>
    {/if}
  </div>
</section>

<style>
  .editor-badges { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .unsaved-badge { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); font-weight: 600; }
  .path-bar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.875rem; }
  .path-bar input { flex: 1 1 14rem; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .editor-empty { margin: 1rem 0 0; }
  .editor-surface {
    display: grid; grid-template-columns: auto minmax(0, 1fr); margin-top: 0.875rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface);
    overflow: hidden; min-height: 18rem; max-height: 32rem;
  }
  .editor-gutter, .editor-textarea {
    margin: 0; padding: 0.75rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.875rem; line-height: 1.5; tab-size: 2;
  }
  .editor-gutter {
    min-width: 3rem; padding-inline: 0.625rem; text-align: right; color: var(--muted);
    background: var(--panel); border-right: 1px solid var(--border); overflow: hidden; user-select: none;
  }
  .editor-textarea {
    width: 100%; min-width: 0; min-height: 18rem; resize: vertical; border: 0;
    background: transparent; color: var(--text); white-space: pre; overflow: auto;
  }
  .editor-textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .editor-hint { margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--muted); }
  @media (max-width: 30rem) { .path-bar button { flex: 1 1 auto; } }
</style>
