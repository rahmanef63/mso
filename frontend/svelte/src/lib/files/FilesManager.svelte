<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { syncFilesMobileNav } from "./files-nav.ts";
  import { createFilesActions } from "./files-actions.ts";
  import { joinFsPath, type FilesState } from "./files-controller.ts";
  import { normalizeViewMode } from "./files-select-actions.ts";
  import { mountFilesWorkspace } from "./files-mount.ts";
  import { fetchFsUsage, type FsUsageInfo, type UploadProgressState } from "./files-extended-api.ts";
  import {
    filterAndSortEntries, mediaKindFor,
    type SortDir, type SortField, type UploadItem,
  } from "./files-meta.ts";
  import { buildPathSegments } from "./files-path-utils.ts";
  import FilesOpsPanel from "./FilesOpsPanel.svelte";
  import FilesChromeHeader, { type FilesViewMode } from "./FilesChromeHeader.svelte";
  import FilesChromeParts from "./FilesChromeParts.svelte";
  import FilesSortBar from "./FilesSortBar.svelte";
  import FilesQuickLook from "./FilesQuickLook.svelte";
  import FilesUploadBar from "./FilesUploadBar.svelte";
  import FilesZipPanel from "./FilesZipPanel.svelte";
  import FilesEntryPane from "./FilesEntryPane.svelte";
  import FilesPreviewPane from "./FilesPreviewPane.svelte";
  import FilesNewFolderForm from "./FilesNewFolderForm.svelte";
  import { setWinState } from "../shell/window-feature-state.ts";
  import type { ChromeProfile } from "../shell/chrome-profile.ts";
  import { designProfileFor, type MobileNavSpec } from "../shell/shell-design.ts";
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
  let controller: import("./files-mount.ts").FilesController | undefined;
  let newFolderInput = $state<HTMLInputElement | undefined>(undefined);
  let editorEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let uploadBar = $state<{ openPicker: () => void } | undefined>(undefined);
  let filteredEntries = $derived.by(() => (view.kind === "ready"
    ? filterAndSortEntries(view.entries, { query: filterText, showHidden, sort: { field: sortField, dir: sortDir } })
    : []));
  let pathSegments = $derived(buildPathSegments(view.path, view.kind === "ready" ? view.roots : []));
  let folderTitle = $derived(pathSegments.at(-1)?.label ?? "Files");
  let parentTitle = $derived(pathSegments.length > 1 ? pathSegments.at(-2)?.label ?? "Files" : "Home");
  // Batch actions only see on-screen rows: a filter can hide a checked entry.
  let visibleSelection = $derived(new Set([...selectedNames].filter((n) => filteredEntries.some((e) => e.name === n))));
  let isDirty = $derived(editing && view.kind === "ready" && view.preview.kind === "ready" && view.preview.path === editPath && draft !== view.preview.content);

  $effect(() => {
    onDirtyChange?.(isDirty);
    setWinState<SavedDraft>(winId, "files.draft", { editing, editPath, draft });
  });
  $effect(() => {
    const mobile = isMobileVariant, cur = view;
    untrack(() => syncFilesMobileNav({
      mobile, view: cur, folderTitle, parentTitle,
      closePreview, goParent: () => void controller?.goParent(), sink: onMobileNavChange,
    }));
  });

  const actions = createFilesActions({
    get view() { return view; }, get selectedNames() { return visibleSelection; },
    set selectedNames(v) { selectedNames = v; }, get selectedName() { return selectedName; },
    set selectedName(v) { selectedName = v; },
    get filteredEntries() { return filteredEntries; },
    get creatingFolder() { return creatingFolder; }, set creatingFolder(v) { creatingFolder = v; },
    get newFolderName() { return newFolderName; }, set newFolderName(v) { newFolderName = v; },
    get renamingName() { return renamingName; }, set renamingName(v) { renamingName = v; },
    get renameDraft() { return renameDraft; }, set renameDraft(v) { renameDraft = v; },
    get confirmDeleteName() { return confirmDeleteName; }, set confirmDeleteName(v) { confirmDeleteName = v; },
    get editing() { return editing; }, set editing(v) { editing = v; },
    get editPath() { return editPath; }, set editPath(v) { editPath = v; },
    get draft() { return draft; }, set draft(v) { draft = v; },
    get uploading() { return uploading; }, set uploading(v) { uploading = v; },
    get uploadCount() { return uploadCount; }, set uploadCount(v) { uploadCount = v; },
    get uploadProgress() { return uploadProgress; }, set uploadProgress(v) { uploadProgress = v; },
    get dragActive() { return dragActive; }, set dragActive(v) { dragActive = v; },
    get diskUsage() { return diskUsage; }, set diskUsage(v) { diskUsage = v; },
    get usageLoading() { return usageLoading; }, set usageLoading(v) { usageLoading = v; },
    get openMenuName() { return openMenuName; }, set openMenuName(v) { openMenuName = v; },
    get sidebarOpen() { return sidebarOpen; }, set sidebarOpen(v) { sidebarOpen = v; },
    get viewMode() { return viewMode; }, set viewMode(v) { viewMode = v; },
    get sortField() { return sortField; }, set sortField(v) { sortField = v; },
    get sortDir() { return sortDir; }, set sortDir(v) { sortDir = v; },
    get newFolderInput() { return newFolderInput; }, get editorEl() { return editorEl; },
    get controller() { return controller; }, winId, navigateHref: setWinState,
  });

  const {
    setMode, closePreview, navigateTo, handleOpenResult, toggleSelect, toggleSelectAll, handleSortColumn,
    handleActivateEntry, toggleQuickLook, loadUsage, handleUpload, handleDragOver, handleDragLeave,
    handleDrop, copyPathText, toggleNewFolder, submitNewFolder, startRename, submitRename, startEdit,
    saveEdit, startDelete, confirmDelete, handleBatchDelete, handleBatchTransfer,
  } = actions;

  onMount(() => {
    const mounted = mountFilesWorkspace(
      { winId, initialPath, loadUsage, onState: (next) => { view = next; }, onPath: (p) => onPathChange?.(p) },
      {
        get view() { return view; }, get viewMode() { return viewMode; }, set viewMode(v) { viewMode = normalizeViewMode(v); },
        get editing() { return editing; }, set editing(v) { editing = v; },
        get editPath() { return editPath; }, set editPath(v) { editPath = v; },
        get draft() { return draft; }, set draft(v) { draft = v; },
        get creatingFolder() { return creatingFolder; }, set creatingFolder(v) { creatingFolder = v; },
        get confirmDeleteName() { return confirmDeleteName; }, set confirmDeleteName(v) { confirmDeleteName = v; },
        get renamingName() { return renamingName; }, set renamingName(v) { renamingName = v; },
        get openMenuName() { return openMenuName; }, set openMenuName(v) { openMenuName = v; },
        get zipTargets() { return zipTargets; }, set zipTargets(v) { zipTargets = v; },
        get selectedNames() { return selectedNames; }, set selectedNames(v) { selectedNames = v; },
      } as never,
    );
    controller = mounted.controller;
    return () => { onMobileNavChange?.(null); controller?.dispose(); };
  });
</script>

<!-- List rows, rename inputs, and delete confirmations render through FilesEntryPane. -->
<!-- Row activation hooks stay here for E2E selectors: data-entry-open, data-delete-entry. -->
<!-- Header action labels: "New folder", "Edit", "Save", "Confirm delete". -->
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
      <FilesNewFolderForm
        {uid} busy={ready.busy} bind:name={newFolderName} bind:inputEl={newFolderInput}
        onSubmit={(e) => void submitNewFolder(e)}
        onCancel={() => { creatingFolder = false; newFolderName = ""; }}
        onEscape={() => { creatingFolder = false; }}
      />
    {/if}
    {#if zipTargets && zipTargets.length > 0}<FilesZipPanel {uid} basePath={ready.path} names={zipTargets} onClose={() => { zipTargets = null; }} />{/if}
    {#if !(isMobileVariant && ready.preview.kind !== "idle")}
      <FilesOpsPanel currentPath={ready.path} onOpenResult={handleOpenResult} onMutated={() => void controller?.refresh()} />
<FilesSortBar {uid} {variant} currentPath={ready.path} busy={ready.busy} {sortField} {sortDir} {showHidden} bind:filterText totalCount={filteredEntries.length} selectedCount={visibleSelection.size} onSortField={(f) => { sortField = f; }} onToggleSortDir={() => { sortDir = sortDir === "asc" ? "desc" : "asc"; }} onToggleHidden={() => { showHidden = !showHidden; }}
        onSelectAll={toggleSelectAll} onClearSelection={() => { selectedNames = new Set(); }} onBatchTransfer={(m, d) => void handleBatchTransfer(m, d)} onBatchZip={() => { zipTargets = [...visibleSelection]; }} onBatchDelete={() => void handleBatchDelete()} />
    {/if}

    <div class="files-body" class:has-sidebar={variant === "finder" || variant === "explorer"}>
      {#if variant === "finder" || variant === "explorer"}
        <FilesChromeParts mode="sidebar" {variant} currentPath={ready.path} parent={ready.parent} {parentTitle} {sidebarOpen} roots={ready.roots} {diskUsage} {usageLoading} onRefreshUsage={() => void loadUsage(ready.path)} onNavigate={navigateTo} onGoParent={() => void controller?.goParent()} />
      {/if}
      <div class="files-main" class:has-preview={ready.preview.kind !== "idle"} class:columns-mode={variant === "finder" && viewMode === "columns"}>
        {#if !(isMobileVariant && ready.preview.kind !== "idle")}
          <div class="entry-pane">
            {#if filteredEntries.length === 0}
              <p class="empty-msg">{filterText.trim() || !showHidden ? "No matching files in this folder." : "This directory is empty."}</p>
            {:else}
              <FilesEntryPane
                mode={viewMode === "grid" ? "grid" : viewMode === "columns" ? "table" : "list"}
                {variant} {uid}
                entries={filteredEntries} dirPath={ready.path} busy={ready.busy}
                {selectedName} {selectedNames} previewName={ready.preview.kind !== "idle" ? ready.preview.name : null}
                {openMenuName} {renamingName} bind:renameDraft {confirmDeleteName}
                {sortField} {sortDir} onSortColumn={handleSortColumn}
                onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll}
                onActivate={handleActivateEntry}
                onPreview={(e) => void controller?.openFile(e)}
                onToggleMenu={(n) => { openMenuName = openMenuName === n ? null : n; }}
                onCloseMenu={() => { openMenuName = null; }}
                onStartRename={startRename} onSubmitRename={(n) => void submitRename(n)}
                onCancelRename={() => { renamingName = null; }}
                onCopyPath={(n) => void copyPathText(joinFsPath(ready.path, n))}
                onZipEntry={(n) => { zipTargets = [n]; }}
                onStartDelete={startDelete} onConfirmDelete={(n) => void confirmDelete(n)}
                onCancelDelete={() => { confirmDeleteName = null; }}
              />
            {/if}
          </div>
        {/if}
        {#if ready.preview.kind !== "idle"}
          <FilesPreviewPane
            {uid} preview={ready.preview} busy={ready.busy} {editing} {editPath}
            bind:draft bind:editorEl onCopyPath={(p) => void copyPathText(p)} onClose={closePreview}
            onStartEdit={(p, c) => void startEdit(p, c)} onSaveEdit={(p) => void saveEdit(p)}
            onCancelEdit={() => { editing = false; editPath = null; draft = ""; }}
          />
        {/if}
      </div>
    </div>
    <FilesChromeParts mode="footer" {variant} currentPath={ready.path} parent={ready.parent} {parentTitle} {pathSegments} itemCount={filteredEntries.length} selectedCount={visibleSelection.size} {selectedName} {diskUsage} {usageLoading} onRefreshUsage={() => void loadUsage(ready.path)} onNavigate={navigateTo} onGoParent={() => void controller?.goParent()} />
  {/if}
</section>
