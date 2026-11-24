<script lang="ts">
  import { onMount, tick } from "svelte";
  import { bytes } from "../format.ts";
  import { createFilesController, joinFsPath, type FilesState } from "./files-controller.ts";
  import { buildPathSegments } from "./files-path-utils.ts";
  import FilesOpsPanel from "./FilesOpsPanel.svelte";
  import FilesChromeHeader, { type FilesViewMode } from "./FilesChromeHeader.svelte";
  import FilesChromeParts from "./FilesChromeParts.svelte";
  import FilesExplorerTable from "./FilesExplorerTable.svelte";
  import type { ChromeProfile } from "../shell/chrome-profile.ts";
  import { designProfileFor, type MobileNavSpec } from "../shell/shell-design.ts";
  import { getWinState, setWinState } from "../shell/window-feature-state.ts";
  import "./files-chrome.css";

  type SavedDraft = { editing: boolean; editPath: string | null; draft: string };
  let { winId, initialPath = "~", resolvedChrome = "macos", onPathChange, onDirtyChange, onMobileNavChange }: {
    winId?: string; initialPath?: string; resolvedChrome?: ChromeProfile;
    onPathChange?: (path: string) => void; onDirtyChange?: (dirty: boolean) => void;
    onMobileNavChange?: (nav: MobileNavSpec | null) => void;
  } = $props();

  const uid = $props.id();
  let design = $derived(designProfileFor(resolvedChrome));
  let variant = $derived(design.filesVariant);
  let isMobileVariant = $derived(variant === "ios-files" || variant === "android-files");

  let view = $state<FilesState>({ kind: "loading", path: "~" });
  let viewMode = $state<FilesViewMode>("list");
  let filterText = $state(""), selectedName = $state<string | null>(null), sidebarOpen = $state(false);
  let creatingFolder = $state(false), newFolderName = $state(""), confirmDeleteName = $state<string | null>(null);
  let editing = $state(false), editPath = $state<string | null>(null), draft = $state("");
  let controller: ReturnType<typeof createFilesController> | undefined;
  let newFolderInput = $state<HTMLInputElement | undefined>(undefined);
  let editorEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let lastPath = "";

  let filteredEntries = $derived.by(() => {
    if (view.kind !== "ready") return [];
    const q = filterText.trim().toLowerCase();
    return q ? view.entries.filter((e) => e.name.toLowerCase().includes(q)) : view.entries;
  });
  let pathSegments = $derived(buildPathSegments(view.path));
  let folderTitle = $derived(pathSegments.at(-1)?.label ?? "Files");
  let parentTitle = $derived(pathSegments.length > 1 ? pathSegments.at(-2)?.label ?? "Files" : "Home");
  let isDirty = $derived(
    editing && view.kind === "ready" && view.preview.kind === "ready"
      && view.preview.path === editPath && draft !== view.preview.content,
  );

  $effect(() => { onDirtyChange?.(isDirty); setWinState<SavedDraft>(winId, "files.draft", { editing, editPath, draft }); });
  $effect(() => {
    if (!onMobileNavChange) return;
    if (!isMobileVariant || view.kind !== "ready") { onMobileNavChange(null); return; }
    if (view.preview.kind !== "idle") {
      onMobileNavChange({ title: view.preview.name, backLabel: folderTitle, onBack: () => { editing = false; editPath = null; controller?.closePreview(); } });
    } else if (view.parent) {
      onMobileNavChange({ title: folderTitle, backLabel: parentTitle, onBack: () => void controller?.goParent() });
    } else { onMobileNavChange(null); }
  });

  function setMode(next: FilesViewMode) { viewMode = next; setWinState(winId, "files.viewMode", next); }
  function navigateTo(nextPath: string) { sidebarOpen = false; setWinState(winId, "files.path", nextPath); void controller?.openDir(nextPath); }
  function handleOpenResult(path: string, kind?: "dir" | "file") { if (kind === "dir") navigateTo(path); else void controller?.openFile(path); }
  function handleActivateEntry(entry: { name: string; kind: "dir" | "file"; size: number }) {
    selectedName = entry.name;
    if (view.kind !== "ready") return;
    if (entry.kind === "dir") navigateTo(joinFsPath(view.path, entry.name));
    else void controller?.openFile(entry);
  }
  async function toggleNewFolder() {
    if (creatingFolder) { creatingFolder = false; newFolderName = ""; return; }
    controller?.clearFeedback(); creatingFolder = true; newFolderName = ""; await tick(); newFolderInput?.focus();
  }
  async function submitNewFolder(event: SubmitEvent) {
    event.preventDefault();
    if (await controller?.mkdir(newFolderName)) { creatingFolder = false; newFolderName = ""; }
    else { await tick(); newFolderInput?.focus(); }
  }
  async function startEdit(path: string, content: string) { controller?.clearFeedback(); editing = true; editPath = path; draft = content; await tick(); editorEl?.focus(); }
  async function saveEdit(path: string) { if (await controller?.saveFile(path, draft)) { editing = false; editPath = null; } }
  function startDelete(name: string) { controller?.clearFeedback(); confirmDeleteName = name; }
  async function confirmDelete(name: string) { await controller?.removeEntry(name); confirmDeleteName = null; }

  onMount(() => {
    viewMode = getWinState<FilesViewMode>(winId, "files.viewMode", "list");
    const restoredPath = getWinState<string>(winId, "files.path", initialPath);
    const savedDraft = getWinState<SavedDraft | null>(winId, "files.draft", null);
    controller = createFilesController((next) => {
      view = next;
      if (next.kind === "ready") {
        setWinState(winId, "files.path", next.path); onPathChange?.(next.path);
        if (next.path !== lastPath) {
          lastPath = next.path; creatingFolder = false; confirmDeleteName = null;
          if (!savedDraft?.editing) { editing = false; editPath = null; }
        } else if (next.preview.kind !== "ready" || next.preview.path !== editPath) {
          editing = false; editPath = null;
        }
      } else { creatingFolder = false; confirmDeleteName = null; editing = false; editPath = null; }
    }, { initialPath: restoredPath });
    void controller.openDir(restoredPath).then(() => {
      if (savedDraft?.editing && savedDraft.editPath) {
        const name = savedDraft.editPath.split("/").pop() ?? savedDraft.editPath;
        void controller?.openFile({ name }).then(() => { editing = true; editPath = savedDraft.editPath; draft = savedDraft.draft; });
      }
    });
    return () => { onMobileNavChange?.(null); controller?.dispose(); };
  });
</script>

<section class={`files-shell is-${variant}`} aria-labelledby={`${uid}-title`} aria-busy={view.kind === "loading" || (view.kind === "ready" && view.busy)} data-files-state={view.kind} data-files-variant={variant} data-shell-family={design.family}>
  <h2 id={`${uid}-title`} class="sr-only">Files ({variant})</h2>
  <FilesChromeHeader {uid} {variant} path={view.path} {folderTitle} {pathSegments} canGoParent={view.kind === "ready" && Boolean(view.parent)} loading={view.kind === "loading"} busy={view.kind === "ready" && view.busy} {viewMode} bind:filterText bind:sidebarOpen {creatingFolder} onGoParent={() => void controller?.goParent()} onNavigate={navigateTo} onViewMode={setMode} onToggleNewFolder={() => void toggleNewFolder()} onRefresh={() => void controller?.refresh()} />

  {#if view.kind === "loading"}
    <p class="files-status" role="status" aria-live="polite">Loading directory contents...</p>
  {:else if view.kind === "error"}
    <div class="feedback error" role="alert"><p>{view.message}</p><button type="button" onclick={() => void controller?.refresh()}>Retry</button></div>
  {:else}
    {@const ready = view}
    {#if ready.notice}<p class="feedback ok" role="status" aria-live="polite">{ready.notice}</p>{/if}
    {#if ready.actionError}<p class="feedback error" role="alert">{ready.actionError}</p>{/if}
    {#if creatingFolder}
      <form class="inline-form" onsubmit={(e) => void submitNewFolder(e)}>
        <label for={`${uid}-new-folder`}>New folder name</label>
        <div class="inline-form-row">
          <input id={`${uid}-new-folder`} type="text" bind:value={newFolderName} bind:this={newFolderInput} disabled={ready.busy} placeholder="folder-name" autocomplete="off" onkeydown={(e) => { if (e.key === "Escape") creatingFolder = false; }} />
          <button type="submit" class="primary" disabled={ready.busy}>{ready.busy ? "Creating..." : "Create"}</button>
          <button type="button" disabled={ready.busy} onclick={() => { creatingFolder = false; newFolderName = ""; }}>Cancel</button>
        </div>
      </form>
    {/if}
    {#if !(isMobileVariant && ready.preview.kind !== "idle")}
      <FilesOpsPanel currentPath={ready.path} onOpenResult={handleOpenResult} onMutated={() => void controller?.refresh()} />
    {/if}

    <div class="files-body" class:has-sidebar={variant === "finder" || variant === "explorer"}>
      {#if variant === "finder" || variant === "explorer"}
        <FilesChromeParts mode="sidebar" {variant} currentPath={ready.path} parent={ready.parent} {parentTitle} {sidebarOpen} onNavigate={navigateTo} onGoParent={() => void controller?.goParent()} />
      {/if}
      <div class="files-main" class:columns-mode={variant === "finder" && viewMode === "columns"}>
        {#if !(isMobileVariant && ready.preview.kind !== "idle")}
          <div class="entry-pane">
            {#if filteredEntries.length === 0}
              <p class="empty-msg">{filterText.trim() ? "No matching files in this folder." : "This directory is empty."}</p>
            {:else if variant === "explorer" && viewMode === "list"}
              <FilesExplorerTable
                entries={filteredEntries} busy={ready.busy} {selectedName}
                previewName={ready.preview.kind !== "idle" ? ready.preview.name : null}
                {confirmDeleteName} onActivate={handleActivateEntry} onStartDelete={startDelete}
                onConfirmDelete={(n) => void confirmDelete(n)} onCancelDelete={() => { confirmDeleteName = null; }}
              />
            {:else}
              <ul class={viewMode === "grid" ? "icon-grid" : "entry-list"}>
                {#each filteredEntries as entry (entry.name)}
                  <li class={viewMode === "grid" ? "icon-cell" : "entry-item"}>
                    <button type="button" class={viewMode === "grid" ? "icon-open" : "entry-row"} class:is-dir={entry.kind === "dir"} class:selected={selectedName === entry.name || (ready.preview.kind !== "idle" && ready.preview.name === entry.name)} disabled={ready.busy} data-entry-open={entry.name} onclick={() => handleActivateEntry(entry)}>
                      <span class="entry-name"><span class="kind-badge">{entry.kind === "dir" ? "DIR" : "FILE"}</span><span>{entry.name}</span></span>
                      <span class="entry-trailing">{#if entry.kind === "file"}<span class="size-badge">{bytes(entry.size)}</span>{/if}{#if variant === "ios-files" && entry.kind === "dir"}<span class="ios-chev" aria-hidden="true">&#8250;</span>{/if}</span>
                    </button>
                    <div class="entry-actions">
                      {#if confirmDeleteName === entry.name}
                        <button type="button" class="danger" disabled={ready.busy} onclick={() => void confirmDelete(entry.name)}>Confirm delete</button>
                        <button type="button" disabled={ready.busy} onclick={() => { confirmDeleteName = null; }}>Cancel</button>
                      {:else}
                        <button type="button" class="entry-delete" disabled={ready.busy} data-delete-entry={entry.name} aria-label={`Delete ${entry.name}`} onclick={() => startDelete(entry.name)}>Delete</button>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
        {#if ready.preview.kind !== "idle"}
          {@const preview = ready.preview}
          <aside class="preview-pane" aria-label={`Preview of ${preview.name}`}>
            <header class="preview-header">
              <div class="preview-meta"><strong>{preview.name}</strong><code>{preview.path}</code></div>
              <div class="preview-actions">
                {#if preview.kind === "ready" && !(editing && editPath === preview.path)}<button type="button" disabled={ready.busy} onclick={() => void startEdit(preview.path, preview.content)}>Edit</button>{/if}
                <button type="button" disabled={ready.busy} onclick={() => { editing = false; editPath = null; controller?.closePreview(); }}>Close preview</button>
              </div>
            </header>
            {#if preview.kind === "loading"}<p role="status" aria-live="polite">Reading file...</p>
            {:else if preview.kind === "error"}<p class="feedback error" role="alert">{preview.message}</p>
            {:else if editing && editPath === preview.path}
              <div class="editor-wrap">
                <label class="sr-only" for={`${uid}-editor`}>Edit {preview.name}</label>
                <textarea id={`${uid}-editor`} class="preview-editor" bind:value={draft} bind:this={editorEl} disabled={ready.busy} rows="14"></textarea>
                <div class="editor-actions">
                  <button type="button" class="primary" disabled={ready.busy} onclick={() => void saveEdit(preview.path)}>{ready.busy ? "Saving..." : "Save"}</button>
                  <button type="button" disabled={ready.busy} onclick={() => { editing = false; editPath = null; draft = ""; }}>Cancel</button>
                  {#if draft !== preview.content}<span class="dirty-notice">Unsaved changes</span>{/if}
                </div>
              </div>
            {:else}<pre class="preview-code"><code>{preview.content}</code></pre>{/if}
          </aside>
        {/if}
      </div>
    </div>
    <FilesChromeParts mode="footer" {variant} currentPath={ready.path} parent={ready.parent} {parentTitle} {pathSegments} itemCount={filteredEntries.length} {selectedName} onNavigate={navigateTo} onGoParent={() => void controller?.goParent()} />
  {/if}
</section>
