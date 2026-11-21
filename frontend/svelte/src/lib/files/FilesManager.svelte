<script lang="ts">
  import { onMount } from "svelte";
  import { bytes } from "../format";
  import { createFilesController, joinFsPath, type FilesState } from "./files-controller";

  let {
    initialPath = "~",
    onPathChange,
  }: {
    initialPath?: string;
    onPathChange?: (path: string) => void;
  } = $props();

  let view = $state<FilesState>({ kind: "loading", path: "~" });
  let controller: ReturnType<typeof createFilesController> | undefined;

  onMount(() => {
    controller = createFilesController(
      (next) => {
        view = next;
        if (next.kind === "ready") onPathChange?.(next.path);
      },
      { initialPath },
    );
    void controller.openDir(initialPath);
    return () => controller?.dispose();
  });
</script>

<section class="files-shell" aria-labelledby="files-title" aria-busy={view.kind === "loading"} data-files-state={view.kind}>
  <header class="feature-header">
    <div class="path-group">
      <h2 id="files-title">Files</h2>
      <code class="current-path" title={view.path}>{view.path}</code>
    </div>
    <div class="actions">
      <button
        type="button"
        disabled={view.kind !== "ready" || !view.parent}
        onclick={() => void controller?.goParent()}
      >
        Up
      </button>
      <button
        type="button"
        disabled={view.kind === "loading"}
        onclick={() => void controller?.refresh()}
      >
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    </div>
  </header>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading directory contents...</p>
    {:else if view.kind === "error"}
      <div class="feedback error">
        <p>{view.message}</p>
        <button type="button" onclick={() => void controller?.refresh()}>Retry</button>
      </div>
    {:else}
      <div class="files-layout">
        <div class="entry-pane">
          {#if view.entries.length === 0}
            <p class="empty-msg">This directory is empty.</p>
          {:else}
            <ul class="entry-list">
              {#each view.entries as entry (entry.name)}
                <li>
                  <button
                    type="button"
                    class="entry-row"
                    class:is-dir={entry.kind === "dir"}
                    class:selected={view.preview.kind !== "idle" && view.preview.name === entry.name}
                    onclick={() => entry.kind === "dir"
                      ? void controller?.openDir(joinFsPath(view.path, entry.name))
                      : void controller?.openFile(entry)}
                  >
                    <span class="entry-name">
                      <span class="kind-badge">{entry.kind === "dir" ? "DIR" : "FILE"}</span>
                      <span>{entry.name}</span>
                    </span>
                    {#if entry.kind === "file"}
                      <span class="size-badge">{bytes(entry.size)}</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        {#if view.preview.kind !== "idle"}
          <aside class="preview-pane" aria-label={`Preview of ${view.preview.name}`}>
            <header class="preview-header">
              <div class="preview-meta">
                <strong>{view.preview.name}</strong>
                <code>{view.preview.path}</code>
              </div>
              <button type="button" onclick={() => controller?.closePreview()}>Close preview</button>
            </header>
            {#if view.preview.kind === "loading"}
              <p>Reading file...</p>
            {:else if view.preview.kind === "error"}
              <p class="feedback error" role="alert">{view.preview.message}</p>
            {:else}
              <pre class="preview-code"><code>{view.preview.content}</code></pre>
            {/if}
          </aside>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .files-shell { display: grid; gap: 1rem; min-width: 0; }
  .path-group { display: grid; gap: .25rem; min-width: 0; }
  .current-path { font-size: .875rem; color: var(--muted); overflow-wrap: anywhere; }
  .files-layout { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); }
  @container (min-width: 44rem) { .files-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; } }
  .entry-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .5rem; }
  .entry-row {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: .75rem;
    min-height: var(--ui-control-height, 2.75rem); padding: .5rem .75rem; text-align: left;
    background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: .5rem;
  }
  .entry-row:hover, .entry-row.selected { border-color: var(--accent); }
  .entry-name { display: flex; align-items: center; gap: .5rem; min-width: 0; overflow-wrap: anywhere; }
  .kind-badge, .size-badge {
    flex-shrink: 0; font-size: .75rem; padding: .125rem .45rem;
    border: 1px solid var(--border); border-radius: 999px; color: var(--muted);
  }
  .entry-row.is-dir .kind-badge { color: var(--accent); border-color: var(--accent); }
  .preview-pane { display: grid; gap: .75rem; min-width: 0; padding: .75rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--surface); }
  .preview-header { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
  .preview-meta { display: grid; gap: .125rem; min-width: 0; }
  .preview-meta code { font-size: .75rem; color: var(--muted); overflow-wrap: anywhere; }
  .preview-code { margin: 0; padding: .75rem; max-height: 24rem; overflow: auto; background: var(--panel); border: 1px solid var(--border); border-radius: .375rem; font-size: .8125rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .empty-msg { margin: 0; color: var(--muted); }
</style>
