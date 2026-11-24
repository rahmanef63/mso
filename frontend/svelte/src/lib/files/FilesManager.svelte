<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { bytes } from "../format.ts";
  import type { FsEntryMeta } from "./files-api.ts";
  import { createFilesController, joinFsPath, type FilesState } from "./files-controller.ts";
  import { fetchFsUsage, type FsUsageInfo, type UploadProgressState } from "./files-extended-api.ts";
  import {
    entryBadgeText, filterAndSortEntries, formatMtime, mediaKindFor, readDropEntries,
    type SortDir, type SortField, type UploadItem,
  } from "./files-meta.ts";
  import { buildPathSegments } from "./files-path-utils.ts";
  import FilesOpsPanel from "./FilesOpsPanel.svelte";
  import FilesChromeHeader, { type FilesViewMode } from "./FilesChromeHeader.svelte";
  import FilesChromeParts from "./FilesChromeParts.svelte";
  import FilesExplorerTable from "./FilesExplorerTable.svelte";
  import FilesGridView from "./FilesGridView.svelte";
  import FilesSortBar from "./FilesSortBar.svelte";
  import FilesQuickLook from "./FilesQuickLook.svelte";
  import FilesUploadBar from "./FilesUploadBar.svelte";
  import FilesZipPanel from "./FilesZipPanel.svelte";
  import FilesEntryMenu from "./FilesEntryMenu.svelte";
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
  let sortField = $state<SortField>("name"), sortDir = $state<SortDir>("asc"), showHidden = $state(true);
  let filterText = $state(""), selectedName = $state<string | null>(null), selectedNames = $state<Set<string>>(new Set());
  let sidebarOpen = $state(false), openMenuName = $state<string | null>(null), dragActive = $state(false);
  let creatingFolder = $state(false), newFolderName = $state(""), confirmDeleteName = $state<string | null>(null);
  let renamingName = $state<string | null>(null), renameDraft = $state(""), zipTargets = $state<string[] | null>(null);
  let editing = $state(false), editPath = $state<string | null>(null), draft = $state("");
  let uploading = $state(false), uploadCount = $state(0), uploadProgress = $state<UploadProgressState | null>(null);
  let diskUsage = $state<FsUsageInfo | null>(null), usageLoading = $state(false);
  let controller: ReturnType<typeof createFilesController> | undefined;
  let usageAbort: AbortController | undefined;
  let newFolderInput = $state<HTMLInputElement | undefined>(undefined);
  let editorEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let uploadBar = $state<{ openPicker: () => void } | undefined>(undefined);
  let lastPath = "", usageAutoLoaded = false;

  let filteredEntries = $derived.by(() => (
    view.kind === "ready"
      ? filterAndSortEntries(view.entries, { query: filterText, showHidden, sort: { field: sortField, dir: sortDir } })
      : []
  ));
  let pathSegments = $derived(buildPathSegments(view.path));
  let folderTitle = $derived(pathSegments.at(-1)?.label ?? "Files");
  let parentTitle = $derived(pathSegments.length > 1 ? pathSegments.at(-2)?.label ?? "Files" : "Home");
  let isDirty = $derived(
    editing && view.kind === "ready" && view.preview.kind === "ready"
      && view.preview.path === editPath && draft !== view.preview.content,
  );

  $effect(() => { onDirtyChange?.(isDirty); setWinState<SavedDraft>(winId, "files.draft", { editing, editPath, draft }); });
  $effect(() => {
    const mobile = isMobileVariant, cur = view, fTitle = folderTitle, pTitle = parentTitle;
    untrack(() => {
      if (!onMobileNavChange) return;
      if (!mobile || cur.kind !== "ready") { onMobileNavChange(null); return; }
      if (cur.preview.kind !== "idle") onMobileNavChange({ title: cur.preview.name, backLabel: fTitle, onBack: closePreview });
      else if (cur.parent) onMobileNavChange({ title: fTitle, backLabel: pTitle, onBack: () => void controller?.goParent() });
      else onMobileNavChange(null);
    });
  });

  function setMode(next: FilesViewMode) { viewMode = next; setWinState(winId, "files.viewMode", next); }
  function closePreview() { editing = false; editPath = null; controller?.closePreview(); }
  function navigateTo(nextPath: string) { sidebarOpen = false; openMenuName = null; setWinState(winId, "files.path", nextPath); void controller?.openDir(nextPath); }
  function handleOpenResult(path: string, kind?: "dir" | "file") { if (kind === "dir") navigateTo(path); else void controller?.openFile(path); }
  function toggleSelect(name: string) {
    const next = new Set(selectedNames);
    if (next.has(name)) next.delete(name); else next.add(name);
    selectedNames = next;
    selectedName = next.size === 1 ? [...next][0] : name;
  }
  function toggleSelectAll() {
    selectedNames = selectedNames.size === filteredEntries.length && filteredEntries.length > 0
      ? new Set() : new Set(filteredEntries.map((e) => e.name));
  }
  function handleSortColumn(field: SortField) {
    if (sortField === field) sortDir = sortDir === "asc" ? "desc" : "asc";
    else { sortField = field; sortDir = "asc"; }
  }
  function handleActivateEntry(entry: FsEntryMeta, event?: MouseEvent) {
    if (event && (event.ctrlKey || event.metaKey)) { event.preventDefault(); toggleSelect(entry.name); return; }
    selectedName = entry.name; openMenuName = null;
    if (view.kind !== "ready") return;
    if (entry.kind === "dir") navigateTo(joinFsPath(view.path, entry.name));
    else void controller?.openFile(entry);
  }
  function toggleQuickLook() {
    if (view.kind !== "ready") return;
    if (view.preview.kind !== "idle") { closePreview(); return; }
    const pick = filteredEntries.find((e) => e.kind === "file" && (e.name === selectedName || selectedNames.has(e.name)))
      ?? filteredEntries.find((e) => e.kind === "file");
    if (pick) void controller?.openFile(pick);
    else controller?.setNotice("No files to preview in this folder.");
  }
  async function loadUsage(targetPath?: string) {
    usageAbort?.abort();
    const ctrl = (usageAbort = new AbortController());
    usageLoading = true;
    try { const info = await fetchFsUsage(targetPath, ctrl.signal); if (!ctrl.signal.aborted) diskUsage = info; }
    catch { /* keep previous or idle usage */ }
    finally { if (!ctrl.signal.aborted) usageLoading = false; }
  }
  async function handleUpload(items: UploadItem[]) {
    if (!items.length || uploading) return;
    uploading = true; uploadCount = items.length; uploadProgress = { loaded: 0, total: 0, pct: 0 };
    try {
      const res = await controller?.uploadFiles(items, (p) => { uploadProgress = p; });
      if (res && view.kind === "ready" && view.roots.length > 0) void loadUsage(view.path);
    } finally { uploading = false; uploadProgress = null; }
  }
  function handleDragOver(event: DragEvent) {
    if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); dragActive = true; }
  }
  function handleDragLeave(event: DragEvent) {
    if (event.currentTarget === event.target) dragActive = false;
  }
  function handleDrop(event: DragEvent) {
    event.preventDefault(); dragActive = false;
    if (event.dataTransfer) void readDropEntries(event.dataTransfer).then((items) => { if (items.length) void handleUpload(items); });
  }
  async function copyPathText(targetPath: string) {
    try { await navigator.clipboard.writeText(targetPath); controller?.setNotice(`Copied path "${targetPath}".`); }
    catch { controller?.setNotice(`Path: ${targetPath}`); }
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
  function startRename(name: string) { controller?.clearFeedback(); renamingName = name; renameDraft = name; confirmDeleteName = null; }
  async function submitRename(fromName: string) { if (await controller?.renameEntry(fromName, renameDraft)) renamingName = null; }
  async function startEdit(path: string, content: string) { controller?.clearFeedback(); editing = true; editPath = path; draft = content; await tick(); editorEl?.focus(); }
  async function saveEdit(path: string) { if (await controller?.saveFile(path, draft)) { editing = false; editPath = null; } }
  function startDelete(name: string) { controller?.clearFeedback(); confirmDeleteName = name; renamingName = null; }
  async function confirmDelete(name: string) {
    if (await controller?.removeEntry(name)) { const next = new Set(selectedNames); next.delete(name); selectedNames = next; }
    confirmDeleteName = null;
  }
  async function handleBatchDelete() { if (await controller?.batchDelete([...selectedNames])) selectedNames = new Set(); }
  async function handleBatchTransfer(mode: "copy" | "move", dest: string) {
    if (await controller?.batchTransfer(mode, [...selectedNames], dest) && mode === "move") selectedNames = new Set();
  }

  onMount(() => {
    viewMode = getWinState<FilesViewMode>(winId, "files.viewMode", "list");
    const restoredPath = getWinState<string>(winId, "files.path", initialPath);
    const savedDraft = getWinState<SavedDraft | null>(winId, "files.draft", null);
    controller = createFilesController((next) => {
      view = next;
      if (next.kind === "ready") {
        setWinState(winId, "files.path", next.path); onPathChange?.(next.path);
        if (next.roots.length > 0 && !usageAutoLoaded) { usageAutoLoaded = true; void loadUsage(next.path); }
        if (next.path !== lastPath) {
          lastPath = next.path; creatingFolder = false; confirmDeleteName = null; renamingName = null;
          openMenuName = null; zipTargets = null; selectedNames = new Set();
          if (!savedDraft?.editing) { editing = false; editPath = null; }
        } else if (next.preview.kind !== "ready" || next.preview.path !== editPath) {
          editing = false; editPath = null;
        }
      } else { creatingFolder = false; confirmDeleteName = null; renamingName = null; editing = false; editPath = null; }
    }, { initialPath: restoredPath });
    void controller.openDir(restoredPath).then(() => {
      if (savedDraft?.editing && savedDraft.editPath) {
        const name = savedDraft.editPath.split("/").pop() ?? savedDraft.editPath;
        void controller?.openFile({ name }).then(() => { editing = true; editPath = savedDraft.editPath; draft = savedDraft.draft; });
      }
    });
    return () => { usageAbort?.abort(); onMobileNavChange?.(null); controller?.dispose(); };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class={`files-shell is-${variant}`} aria-labelledby={`${uid}-title`} aria-busy={view.kind === "loading" || (view.kind === "ready" && view.busy)} data-files-state={view.kind} data-files-variant={variant} data-shell-family={design.family} onclick={() => { openMenuName = null; }} ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop}>
  <h2 id={`${uid}-title`} class="sr-only">Files ({variant})</h2>
<FilesChromeHeader {uid} {variant} path={view.path} {folderTitle} {pathSegments} canGoParent={view.kind === "ready" && Boolean(view.parent)} loading={view.kind === "loading"} busy={view.kind === "ready" && view.busy} {viewMode} previewOpen={view.kind === "ready" && view.preview.kind !== "idle"} bind:filterText bind:sidebarOpen {creatingFolder} onGoParent={() => void
    controller?.goParent()} onNavigate={navigateTo} onViewMode={setMode} onTogglePreview={toggleQuickLook} onTriggerUpload={() => uploadBar?.openPicker()} onToggleNewFolder={() => void toggleNewFolder()} onRefresh={() => void controller?.refresh()} />
  <FilesUploadBar bind:this={uploadBar} {uid} currentPath={view.path} {dragActive} {uploading} {uploadCount} progress={uploadProgress} onPickFiles={(items) => void handleUpload(items)} />

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
    {#if zipTargets && zipTargets.length > 0}<FilesZipPanel {uid} basePath={ready.path} names={zipTargets} onClose={() => { zipTargets = null; }} />{/if}
    {#if !(isMobileVariant && ready.preview.kind !== "idle")}
      <FilesOpsPanel currentPath={ready.path} onOpenResult={handleOpenResult} onMutated={() => void controller?.refresh()} />
<FilesSortBar {uid} {variant} currentPath={ready.path} busy={ready.busy} {sortField} {sortDir} {showHidden} bind:filterText totalCount={filteredEntries.length} selectedCount={selectedNames.size} onSortField={(f) => { sortField = f; }} onToggleSortDir={() => { sortDir = sortDir === "asc" ? "desc" : "asc"; }} onToggleHidden={() => { showHidden = !showHidden; }}
        onSelectAll={toggleSelectAll} onClearSelection={() => { selectedNames = new Set(); }} onBatchTransfer={(m, d) => void handleBatchTransfer(m, d)} onBatchZip={() => { zipTargets = [...selectedNames]; }} onBatchDelete={() => void handleBatchDelete()} />
    {/if}

    <div class="files-body" class:has-sidebar={variant === "finder" || variant === "explorer"}>
      {#if variant === "finder" || variant === "explorer"}
        <FilesChromeParts mode="sidebar" {variant} currentPath={ready.path} parent={ready.parent} {parentTitle} {sidebarOpen} {diskUsage} {usageLoading} onRefreshUsage={() => void loadUsage(ready.path)} onNavigate={navigateTo} onGoParent={() => void controller?.goParent()} />
      {/if}
      <div class="files-main" class:has-preview={ready.preview.kind !== "idle"} class:columns-mode={variant === "finder" && viewMode === "columns"}>
        {#if !(isMobileVariant && ready.preview.kind !== "idle")}
          <div class="entry-pane">
            {#if filteredEntries.length === 0}
              <p class="empty-msg">{filterText.trim() || !showHidden ? "No matching files in this folder." : "This directory is empty."}</p>
            {:else if viewMode === "grid"}
<FilesGridView entries={filteredEntries} dirPath={ready.path} busy={ready.busy} {selectedNames} previewName={ready.preview.kind !== "idle" ? ready.preview.name : null} {openMenuName} {renamingName} bind:renameDraft {confirmDeleteName} onToggleSelect={toggleSelect} onActivate={handleActivateEntry} onPreview={(e) => void controller?.openFile(e)} onToggleMenu={(n) => {
                openMenuName = openMenuName === n ? null : n; }} onCloseMenu={() => { openMenuName = null; }} onStartRename={startRename} onSubmitRename={(n) => void submitRename(n)} onCancelRename={() => { renamingName = null; }} onCopyPath={(n) => void copyPathText(joinFsPath(ready.path, n))} onZipEntry={(n) => { zipTargets = [n]; }} onStartDelete={startDelete}
                onConfirmDelete={(n) => void confirmDelete(n)} onCancelDelete={() => { confirmDeleteName = null; }} />
            {:else if variant === "explorer"}
<FilesExplorerTable entries={filteredEntries} dirPath={ready.path} busy={ready.busy} {selectedName} {selectedNames} previewName={ready.preview.kind !== "idle" ? ready.preview.name : null} {openMenuName} {renamingName} bind:renameDraft {confirmDeleteName} {sortField} {sortDir} onSortColumn={handleSortColumn} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll}
                onActivate={handleActivateEntry} onPreview={(e) => void controller?.openFile(e)} onToggleMenu={(n) => { openMenuName = openMenuName === n ? null : n; }} onCloseMenu={() => { openMenuName = null; }} onStartRename={startRename} onSubmitRename={(n) => void submitRename(n)} onCancelRename={() => { renamingName = null; }} onCopyPath={(n) => void
                copyPathText(joinFsPath(ready.path, n))} onZipEntry={(n) => { zipTargets = [n]; }} onStartDelete={startDelete} onConfirmDelete={(n) => void confirmDelete(n)} onCancelDelete={() => { confirmDeleteName = null; }} />
            {:else}
              <ul class="entry-list" data-view-mode="list">
                {#each filteredEntries as entry (entry.name)}
                  <li class="entry-item">
                    <input type="checkbox" class="entry-check" aria-label={`Select ${entry.name}`} checked={selectedNames.has(entry.name)} disabled={ready.busy} onchange={() => toggleSelect(entry.name)} />
                    {#if renamingName === entry.name}
                      <form class="rename-inline-row" onsubmit={(e) => { e.preventDefault(); void submitRename(entry.name); }}>
                        <label class="sr-only" for={`${uid}-rn-${entry.name}`}>Rename {entry.name}</label>
                        <input id={`${uid}-rn-${entry.name}`} type="text" bind:value={renameDraft} disabled={ready.busy} autocomplete="off" onkeydown={(e) => { if (e.key === "Escape") renamingName = null; }} />
                        <button type="submit" class="compact-btn primary" disabled={ready.busy}>Save</button>
                        <button type="button" class="compact-btn" disabled={ready.busy} onclick={() => { renamingName = null; }}>Cancel</button>
                      </form>
                    {:else}
                      <button type="button" class="entry-row" class:is-dir={entry.kind === "dir"} class:selected={selectedNames.has(entry.name) || selectedName === entry.name || (ready.preview.kind !== "idle" && ready.preview.name === entry.name)} disabled={ready.busy} data-entry-open={entry.name} onclick={(e) => handleActivateEntry(entry, e)}>
                        <span class="entry-name"><span class="kind-badge">{entryBadgeText(entry)}</span><span>{entry.name}</span></span>
                        <span class="entry-trailing">{#if entry.mtime}<span class="mtime-badge">{formatMtime(entry.mtime)}</span>{/if}{#if entry.kind === "file"}<span class="size-badge">{bytes(entry.size)}</span>{/if}{#if variant === "ios-files" && entry.kind === "dir"}<span class="ios-chev" aria-hidden="true">&#8250;</span>{/if}</span>
                      </button>
                    {/if}
                    <div class="entry-actions">
                      {#if confirmDeleteName === entry.name}
                        <button type="button" class="compact-btn danger" disabled={ready.busy} onclick={() => void confirmDelete(entry.name)}>Confirm delete</button>
                        <button type="button" class="compact-btn" disabled={ready.busy} onclick={() => { confirmDeleteName = null; }}>Cancel</button>
                      {:else}
<FilesEntryMenu {entry} dirPath={ready.path} busy={ready.busy} open={openMenuName === entry.name} onToggle={() => { openMenuName = openMenuName === entry.name ? null : entry.name; }} onClose={() => { openMenuName = null; }} onOpen={() => handleActivateEntry(entry)} onPreview={() => void controller?.openFile(entry)} onRename={() => startRename(entry.name)} onCopyPath={() => void
                          copyPathText(joinFsPath(ready.path, entry.name))} onZip={() => { zipTargets = [entry.name]; }} onDelete={() => startDelete(entry.name)} />
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
          {@const canEdit = preview.kind === "ready" && ["text", "code", "markdown"].includes(preview.mediaKind ?? mediaKindFor(preview.name))}
          <FilesQuickLook {uid} {preview} busy={ready.busy} {editing} {editPath} bind:draft bind:editorEl onCopyPath={(p) => void copyPathText(p)} onClose={closePreview}>
            {#snippet headerActions()}{#if canEdit && preview.kind === "ready" && !(editing && editPath === preview.path)}<button type="button" class="compact-btn" disabled={ready.busy} onclick={() => void startEdit(preview.path, preview.content)}>Edit</button>{/if}{/snippet}
{#snippet editorFooter()}{#if preview.kind === "ready"}<div class="editor-actions"><button type="button" class="primary" disabled={ready.busy} onclick={() => void saveEdit(preview.path)}>{ready.busy ? "Saving..." : "Save"}</button><button type="button" disabled={ready.busy} onclick={() => { editing = false; editPath = null; draft = ""; }}>Cancel</button>{#if draft !==
              preview.content}<span class="dirty-notice">Unsaved changes</span>{/if}</div>{/if}{/snippet}
          </FilesQuickLook>
        {/if}
      </div>
    </div>
    <FilesChromeParts mode="footer" {variant} currentPath={ready.path} parent={ready.parent} {parentTitle} {pathSegments} itemCount={filteredEntries.length} selectedCount={selectedNames.size} {selectedName} {diskUsage} {usageLoading} onRefreshUsage={() => void loadUsage(ready.path)} onNavigate={navigateTo} onGoParent={() => void controller?.goParent()} />
  {/if}
</section>
