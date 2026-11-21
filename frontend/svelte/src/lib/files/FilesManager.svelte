<script lang="ts">
  import { onMount, tick } from "svelte";
  import { bytes } from "../format";
  import { createFilesController, joinFsPath, type FilesState } from "./files-controller";

  let {
    initialPath = "~",
    onPathChange,
  }: {
    initialPath?: string;
    onPathChange?: (path: string) => void;
  } = $props();

  const uid = $props.id();
  let view = $state<FilesState>({ kind: "loading", path: "~" });
  let controller: ReturnType<typeof createFilesController> | undefined;

  let creatingFolder = $state(false);
  let newFolderName = $state("");
  let editing = $state(false);
  let editPath = $state<string | null>(null);
  let draft = $state("");
  let confirmDeleteName = $state<string | null>(null);

  let newFolderBtn = $state<HTMLButtonElement | undefined>(undefined);
  let newFolderInput = $state<HTMLInputElement | undefined>(undefined);
  let editBtn = $state<HTMLButtonElement | undefined>(undefined);
  let editorEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let confirmDeleteBtn = $state<HTMLButtonElement | undefined>(undefined);
  let entryListEl = $state<HTMLUListElement | undefined>(undefined);
  let lastPath = "";

  onMount(() => {
    controller = createFilesController(
      (next) => {
        view = next;
        if (next.kind === "ready") {
          onPathChange?.(next.path);
          if (next.path !== lastPath) {
            lastPath = next.path;
            creatingFolder = false;
            newFolderName = "";
            confirmDeleteName = null;
            editing = false;
            editPath = null;
          } else if (next.preview.kind !== "ready" || next.preview.path !== editPath) {
            editing = false;
            editPath = null;
          }
        } else {
          creatingFolder = false;
          confirmDeleteName = null;
          editing = false;
          editPath = null;
        }
      },
      { initialPath },
    );
    void controller.openDir(initialPath);
    return () => controller?.dispose();
  });

  function focusDeleteButton(name: string) {
    const buttons = entryListEl?.querySelectorAll<HTMLButtonElement>("button[data-delete-entry]");
    if (!buttons) return;
    for (const btn of buttons) {
      if (btn.dataset.deleteEntry === name) { btn.focus(); return; }
    }
  }

  async function toggleNewFolder() {
    if (creatingFolder) { await cancelNewFolder(); return; }
    controller?.clearFeedback();
    creatingFolder = true;
    newFolderName = "";
    await tick();
    newFolderInput?.focus();
  }

  async function cancelNewFolder() {
    creatingFolder = false;
    newFolderName = "";
    await tick();
    newFolderBtn?.focus();
  }

  async function submitNewFolder(event: SubmitEvent) {
    event.preventDefault();
    const ok = await controller?.mkdir(newFolderName);
    if (ok) {
      creatingFolder = false;
      newFolderName = "";
      await tick();
      newFolderBtn?.focus();
    } else {
      await tick();
      newFolderInput?.focus();
    }
  }

  async function startEdit(path: string, content: string) {
    controller?.clearFeedback();
    editing = true;
    editPath = path;
    draft = content;
    await tick();
    editorEl?.focus();
  }

  async function cancelEdit() {
    editing = false;
    editPath = null;
    draft = "";
    await tick();
    editBtn?.focus();
  }

  async function saveEdit(path: string) {
    const ok = await controller?.saveFile(path, draft);
    if (ok) {
      editing = false;
      editPath = null;
      await tick();
      editBtn?.focus();
    }
  }

  async function startDelete(name: string) {
    controller?.clearFeedback();
    confirmDeleteName = name;
    await tick();
    confirmDeleteBtn?.focus();
  }

  async function cancelDelete(name: string) {
    confirmDeleteName = null;
    await tick();
    focusDeleteButton(name);
  }

  async function confirmDelete(name: string) {
    const prevIndex = view.kind === "ready" ? view.entries.findIndex((e) => e.name === name) : -1;
    const ok = await controller?.removeEntry(name);
    confirmDeleteName = null;
    await tick();
    if (!ok) {
      focusDeleteButton(name);
      return;
    }
    const openButtons = entryListEl?.querySelectorAll<HTMLButtonElement>("button[data-entry-open]");
    if (openButtons && openButtons.length > 0) {
      const idx = Math.max(0, Math.min(prevIndex, openButtons.length - 1));
      openButtons[idx]?.focus();
    } else {
      newFolderBtn?.focus();
    }
  }
</script>

<section
  class="files-shell"
  aria-labelledby={`${uid}-title`}
  aria-busy={view.kind === "loading" || (view.kind === "ready" && view.busy)}
  data-files-state={view.kind}
>
  <header class="feature-header">
    <div class="path-group">
      <h2 id={`${uid}-title`}>Files</h2>
      <code class="current-path" title={view.path}>{view.path}</code>
    </div>
    <div class="actions">
      <button
        type="button"
        disabled={view.kind !== "ready" || !view.parent || view.busy}
        onclick={() => void controller?.goParent()}
      >
        Up
      </button>
      <button
        type="button"
        bind:this={newFolderBtn}
        aria-expanded={creatingFolder}
        disabled={view.kind !== "ready" || view.busy}
        onclick={() => void toggleNewFolder()}
      >
        New folder
      </button>
      <button
        type="button"
        disabled={view.kind === "loading" || (view.kind === "ready" && view.busy)}
        onclick={() => void controller?.refresh()}
      >
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    </div>
  </header>

  {#if view.kind === "loading"}
    <p role="status" aria-live="polite">Loading directory contents...</p>
  {:else if view.kind === "error"}
    <div class="feedback error" role="alert">
      <p>{view.message}</p>
      <button type="button" onclick={() => void controller?.refresh()}>Retry</button>
    </div>
  {:else}
    {@const ready = view}
    {#if ready.notice}
      <p class="feedback ok" role="status" aria-live="polite">{ready.notice}</p>
    {/if}
    {#if ready.actionError}
      <p class="feedback error" role="alert">{ready.actionError}</p>
    {/if}

    {#if creatingFolder}
      <form class="inline-form" onsubmit={(e) => void submitNewFolder(e)}>
        <label for={`${uid}-new-folder`}>New folder name</label>
        <div class="inline-form-row">
          <input
            id={`${uid}-new-folder`}
            type="text"
            bind:value={newFolderName}
            bind:this={newFolderInput}
            disabled={ready.busy}
            placeholder="folder-name"
            autocomplete="off"
            onkeydown={(e) => { if (e.key === "Escape") void cancelNewFolder(); }}
          />
          <button type="submit" class="primary" disabled={ready.busy}>
            {ready.busy ? "Creating..." : "Create"}
          </button>
          <button type="button" disabled={ready.busy} onclick={() => void cancelNewFolder()}>
            Cancel
          </button>
        </div>
      </form>
    {/if}

    <div class="files-layout">
      <div class="entry-pane">
        {#if ready.entries.length === 0}
          <p class="empty-msg">This directory is empty.</p>
        {:else}
          <ul class="entry-list" bind:this={entryListEl}>
            {#each ready.entries as entry (entry.name)}
              <li class="entry-item">
                <button
                  type="button"
                  class="entry-row"
                  class:is-dir={entry.kind === "dir"}
                  class:selected={ready.preview.kind !== "idle" && ready.preview.name === entry.name}
                  disabled={ready.busy}
                  data-entry-open={entry.name}
                  onclick={() => entry.kind === "dir"
                    ? void controller?.openDir(joinFsPath(ready.path, entry.name))
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
                <div class="entry-actions">
                  {#if confirmDeleteName === entry.name}
                    <button
                      type="button"
                      class="danger"
                      disabled={ready.busy}
                      bind:this={confirmDeleteBtn}
                      onkeydown={(e) => { if (e.key === "Escape") void cancelDelete(entry.name); }}
                      onclick={() => void confirmDelete(entry.name)}
                    >
                      {ready.busy ? "Deleting..." : "Confirm delete"}
                    </button>
                    <button
                      type="button"
                      disabled={ready.busy}
                      onkeydown={(e) => { if (e.key === "Escape") void cancelDelete(entry.name); }}
                      onclick={() => void cancelDelete(entry.name)}
                    >
                      Cancel
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="entry-delete"
                      disabled={ready.busy}
                      data-delete-entry={entry.name}
                      aria-label={`Delete ${entry.name}`}
                      onclick={() => void startDelete(entry.name)}
                    >
                      Delete
                    </button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      {#if ready.preview.kind !== "idle"}
        {@const preview = ready.preview}
        <aside class="preview-pane" aria-label={`Preview of ${preview.name}`}>
          <header class="preview-header">
            <div class="preview-meta">
              <strong>{preview.name}</strong>
              <code>{preview.path}</code>
            </div>
            <div class="preview-actions">
              {#if preview.kind === "ready" && !(editing && editPath === preview.path)}
                <button
                  type="button"
                  bind:this={editBtn}
                  disabled={ready.busy}
                  onclick={() => void startEdit(preview.path, preview.content)}
                >
                  Edit
                </button>
              {/if}
              <button
                type="button"
                disabled={ready.busy}
                onclick={() => { editing = false; editPath = null; controller?.closePreview(); }}
              >
                Close preview
              </button>
            </div>
          </header>
          {#if preview.kind === "loading"}
            <p role="status" aria-live="polite">Reading file...</p>
          {:else if preview.kind === "error"}
            <p class="feedback error" role="alert">{preview.message}</p>
          {:else if editing && editPath === preview.path}
            <div class="editor-wrap">
              <label class="sr-only" for={`${uid}-editor`}>Edit {preview.name}</label>
              <textarea
                id={`${uid}-editor`}
                class="preview-editor"
                bind:value={draft}
                bind:this={editorEl}
                disabled={ready.busy}
                rows="14"
              ></textarea>
              <div class="editor-actions">
                <button
                  type="button"
                  class="primary"
                  disabled={ready.busy}
                  onclick={() => void saveEdit(preview.path)}
                >
                  {ready.busy ? "Saving..." : "Save"}
                </button>
                <button type="button" disabled={ready.busy} onclick={() => void cancelEdit()}>
                  Cancel
                </button>
                {#if draft !== preview.content}
                  <span class="dirty-notice">Unsaved changes</span>
                {/if}
              </div>
            </div>
          {:else}
            <pre class="preview-code"><code>{preview.content}</code></pre>
          {/if}
        </aside>
      {/if}
    </div>
  {/if}
</section>

<style>
  .files-shell { display: grid; gap: 1rem; min-width: 0; }
  .path-group { display: grid; gap: .25rem; min-width: 0; }
  .current-path { font-size: .875rem; color: var(--muted); overflow-wrap: anywhere; }
  .inline-form {
    display: grid; gap: .5rem; min-width: 0; padding: .75rem;
    background: var(--surface); border: 1px solid var(--border); border-radius: .5rem;
  }
  .inline-form label { font-weight: 600; color: var(--text); }
  .inline-form-row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; min-width: 0; }
  .inline-form-row input { flex: 1 1 11rem; min-width: 0; max-width: 100%; }
  .files-layout { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); min-width: 0; }
  @container (min-width: 44rem) { .files-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; } }
  .entry-pane { min-width: 0; }
  .entry-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .5rem; min-width: 0; }
  .entry-item { display: flex; align-items: stretch; gap: .5rem; flex-wrap: wrap; min-width: 0; }
  .entry-row {
    flex: 1 1 11rem; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: .75rem;
    min-height: var(--ui-control-height, 2.75rem); padding: .5rem .75rem; text-align: left;
    background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: .5rem;
  }
  .entry-row:hover, .entry-row.selected { border-color: var(--accent); }
  .entry-actions { display: flex; align-items: center; gap: .375rem; flex-wrap: wrap; max-width: 100%; }
  .entry-delete { padding: .5rem .75rem; }
  .entry-name { display: flex; align-items: center; gap: .5rem; min-width: 0; overflow-wrap: anywhere; }
  .kind-badge, .size-badge {
    flex-shrink: 0; font-size: .75rem; padding: .125rem .45rem;
    border: 1px solid var(--border); border-radius: 999px; color: var(--muted);
  }
  .entry-row.is-dir .kind-badge { color: var(--accent); border-color: var(--accent); }
  .preview-pane { display: grid; gap: .75rem; min-width: 0; max-width: 100%; padding: .75rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--surface); }
  .preview-header { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; min-width: 0; }
  .preview-actions, .editor-actions { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .preview-meta { display: grid; gap: .125rem; min-width: 0; }
  .preview-meta code { font-size: .75rem; color: var(--muted); overflow-wrap: anywhere; }
  .preview-code { margin: 0; padding: .75rem; max-height: 24rem; overflow: auto; background: var(--panel); border: 1px solid var(--border); border-radius: .375rem; font-size: .8125rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .editor-wrap { display: grid; gap: .625rem; min-width: 0; }
  .preview-editor {
    width: 100%; min-width: 0; min-height: 14rem; padding: .75rem; resize: vertical;
    background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: .375rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; line-height: 1.5;
  }
  .preview-editor:disabled { cursor: wait; opacity: .65; }
  .dirty-notice { font-size: .875rem; color: var(--warn); font-weight: 600; }
  .empty-msg { margin: 0; color: var(--muted); }
</style>
