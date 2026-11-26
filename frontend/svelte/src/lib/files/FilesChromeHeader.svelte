<script lang="ts">
  import type { FilesPresentation } from "../shell/shell-design.ts";
  import { viewModeLabel } from "./files-select-actions.ts";

  // "columns" is the legacy persisted value for the third mode. It renders a flat
  // details table, not a hierarchical Finder column browser, so the UI calls it
  // "Details" while the stored value stays "columns" for saved window state.
  // ponytail: real Finder columns needs per-column async listings; add only with
  // browser coverage for multi-level browsing, not as a CSS rearrangement.
  export type FilesViewMode = "list" | "grid" | "columns";
  export type PathCrumb = { label: string; path: string };
  // One list drives all three buttons so a visible label can never disagree with the
  // mode it applies.
  const VIEW_MODES: readonly FilesViewMode[] = ["grid", "list", "columns"];

  let {
    uid,
    variant,
    path,
    folderTitle,
    pathSegments,
    canGoParent,
    loading,
    busy,
    viewMode,
    previewOpen = false,
    filterText = $bindable(""),
    sidebarOpen = $bindable(false),
    creatingFolder,
    onGoParent,
    onNavigate,
    onViewMode,
    onTogglePreview,
    onTriggerUpload,
    onToggleNewFolder,
    onRefresh,
  }: {
    uid: string;
    variant: FilesPresentation;
    path: string;
    folderTitle: string;
    pathSegments: readonly PathCrumb[];
    canGoParent: boolean;
    loading: boolean;
    busy: boolean;
    viewMode: FilesViewMode;
    previewOpen?: boolean;
    filterText: string;
    sidebarOpen: boolean;
    creatingFolder: boolean;
    onGoParent: () => void;
    onNavigate: (p: string) => void;
    onViewMode: (m: FilesViewMode) => void;
    onTogglePreview?: () => void;
    onTriggerUpload?: () => void;
    onToggleNewFolder: () => void;
    onRefresh: () => void;
  } = $props();

  let editingPathBar = $state(false);
  let addressInput = $state("");
  let actionsOpen = $state(false);
  function openAddressEdit() {
    addressInput = path;
    editingPathBar = true;
  }

  function submitAddressBar(event: SubmitEvent) {
    event.preventDefault();
    const target = addressInput.trim();
    if (target) onNavigate(target);
    editingPathBar = false;
  }
</script>

{#if variant === "finder"}
  <header class="finder-toolbar" role="toolbar" aria-label="Finder toolbar">
    <div class="finder-nav-group">
      <button type="button" class="finder-icon-btn nav-toggle-btn" aria-expanded={sidebarOpen} aria-label="Toggle sidebar" onclick={() => { sidebarOpen = !sidebarOpen; }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-list" /></svg>
      </button>
      <button type="button" class="finder-icon-btn" aria-label="Go to parent folder" disabled={!canGoParent || busy} onclick={onGoParent}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-chevron-left" /></svg>
      </button>
      <nav class="finder-crumbs" aria-label="Folder breadcrumbs">
        {#each pathSegments as crumb, i (crumb.path)}
          {#if i > 0}<span class="crumb-sep" aria-hidden="true">/</span>{/if}
          <button type="button" class="finder-crumb" title={crumb.path} onclick={() => onNavigate(crumb.path)}>{crumb.label}</button>
        {/each}
      </nav>
    </div>
    <div class="finder-segment" role="group" aria-label="Finder view mode">
      {#each VIEW_MODES as mode (mode)}
        {@const label = viewModeLabel(mode)}
        <button type="button" class:active={viewMode === mode} aria-pressed={viewMode === mode} aria-label={label} title={label} onclick={() => onViewMode(mode)}>
          {#if mode === "columns"}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16M4 12h16M4 18.5h16M10.5 5.5v13" /></svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true"><use href={mode === "grid" ? "#g-grid" : "#g-list"} /></svg>
          {/if}
        </button>
      {/each}
    </div>
    <label class="finder-search">
      <span class="sr-only">Filter {folderTitle}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-search" /></svg>
      <input id={`${uid}-finder-filter`} type="search" bind:value={filterText} placeholder={`Filter ${folderTitle}`} />
    </label>
    <div class="finder-actions">
      <button type="button" class="finder-icon-btn" aria-label="New Folder" title="New Folder" aria-expanded={creatingFolder} disabled={loading || busy} onclick={onToggleNewFolder}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-plus" /></svg>
      </button>
      {#if onTriggerUpload}
        <button type="button" class="finder-icon-btn" aria-label="Upload files" title="Upload" disabled={loading || busy} onclick={onTriggerUpload}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-arrowup" /></svg>
        </button>
      {/if}
      {#if onTogglePreview}
        <button type="button" class="finder-icon-btn" class:active={previewOpen} aria-label="Quick Look" title="Quick Look" aria-pressed={previewOpen} disabled={loading} onclick={onTogglePreview}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-photo" /></svg>
        </button>
      {/if}
      <button type="button" class="finder-icon-btn" aria-label="Refresh" title="Refresh" disabled={loading || busy} onclick={onRefresh}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-clock" /></svg>
      </button>
    </div>
  </header>
{:else if variant === "explorer"}
  <div class="explorer-chrome">
    <div class="explorer-cmdbar" role="toolbar" aria-label="File Explorer commands">
      <button type="button" class="primary" aria-expanded={creatingFolder} disabled={loading || busy} onclick={onToggleNewFolder}>+ New folder</button>
      {#if onTriggerUpload}
        <button type="button" disabled={loading || busy} onclick={onTriggerUpload}>Upload</button>
      {/if}
      <button type="button" class:active={viewMode === "list"} onclick={() => onViewMode("list")}>Details</button>
      <button type="button" class:active={viewMode === "grid"} onclick={() => onViewMode("grid")}>Tiles</button>
      {#if onTogglePreview}
        <button type="button" class:active={previewOpen} aria-pressed={previewOpen} disabled={loading} onclick={onTogglePreview}>Preview pane</button>
      {/if}
      <button type="button" disabled={loading || busy} onclick={onRefresh}>Refresh</button>
      <button type="button" class="nav-toggle-btn" aria-expanded={sidebarOpen} onclick={() => { sidebarOpen = !sidebarOpen; }}>Navigation pane</button>
    </div>
    <div class="explorer-addr-row">
      <button type="button" aria-label="Up one level" disabled={!canGoParent || busy} onclick={onGoParent}>&#8593; Up</button>
      {#if editingPathBar}
        <form class="explorer-addr-form" onsubmit={submitAddressBar}>
          <label class="sr-only" for={`${uid}-addr`}>Folder address</label>
          <input id={`${uid}-addr`} type="text" bind:value={addressInput} onblur={() => { editingPathBar = false; }} />
          <button type="submit">Go</button>
        </form>
      {:else}
        <div class="explorer-address" role="navigation" aria-label="Explorer address bar">
          <span class="explorer-root-tag">This VPS</span>
          {#each pathSegments as crumb (crumb.path)}
            <span class="crumb-sep" aria-hidden="true">&gt;</span>
            <button type="button" class="crumb-btn" onclick={() => onNavigate(crumb.path)}>{crumb.label}</button>
          {/each}
          <button type="button" class="addr-edit-btn" aria-label="Edit path" onclick={openAddressEdit}>Edit</button>
        </div>
      {/if}
      <label class="sr-only" for={`${uid}-filter`}>Filter {folderTitle}</label>
      <input id={`${uid}-filter`} class="explorer-filter" type="search" bind:value={filterText} placeholder={`Filter ${folderTitle}`} />
    </div>
  </div>
{:else if variant === "ios-files"}
  <div class="ios-files-top">
    <div class="ios-files-bar">
      <button type="button" class="ios-pill-btn" aria-label="Go to parent folder" disabled={!canGoParent || busy} onclick={onGoParent}>Up</button>
      <div class="ios-seg" role="group" aria-label="View style">
        <button type="button" class:active={viewMode === "list"} aria-pressed={viewMode === "list"} onclick={() => onViewMode("list")}>List</button>
        <button type="button" class:active={viewMode === "grid"} aria-pressed={viewMode === "grid"} onclick={() => onViewMode("grid")}>Icons</button>
      </div>
      <button type="button" class="ios-pill-btn" aria-expanded={actionsOpen} aria-pressed={actionsOpen} onclick={() => { actionsOpen = !actionsOpen; }}>Actions</button>
    </div>
  </div>
  {#if actionsOpen}
    <div class="ios-actions-sheet" role="group" aria-label="Files actions">
      {#if onTriggerUpload}
        <button type="button" class="ios-action-row" aria-label="Upload files" disabled={loading || busy} onclick={onTriggerUpload}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-arrowup" /></svg>
          <span>Upload files</span>
        </button>
      {/if}
      <button type="button" class="ios-action-row" aria-expanded={creatingFolder} disabled={loading || busy} onclick={onToggleNewFolder}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-plus" /></svg>
        <span>New folder</span>
      </button>
      {#if onTogglePreview}
        <button type="button" class="ios-action-row" aria-pressed={previewOpen} disabled={loading} onclick={onTogglePreview}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-photo" /></svg>
          <span>{previewOpen ? "Close Quick Look" : "Quick Look"}</span>
        </button>
      {/if}
    </div>
  {/if}
{:else if variant === "android-files"}
  <div class="m3-files-top">
    <div class="m3-crumb-strip" role="navigation" aria-label="Folder breadcrumbs">
      {#each pathSegments as crumb (crumb.path)}
        <button type="button" class="m3-crumb-chip" onclick={() => onNavigate(crumb.path)}>{crumb.label}</button>
      {/each}
    </div>
    <div class="m3-files-actions">
      <label class="sr-only" for={`${uid}-m3-filter`}>Filter files</label>
      <input id={`${uid}-m3-filter`} class="m3-files-search" type="search" bind:value={filterText} placeholder="Filter this folder" />
      <button type="button" class="m3-tonal-btn" onclick={() => onViewMode(viewMode === "grid" ? "list" : "grid")}>
        {viewMode === "grid" ? "List" : "Grid"}
      </button>
      {#if onTriggerUpload}
        <button type="button" class="m3-tonal-btn" disabled={loading || busy} onclick={onTriggerUpload}>Upload</button>
      {/if}
      <button type="button" class="m3-tonal-btn" aria-expanded={creatingFolder} disabled={loading || busy} onclick={onToggleNewFolder}>New folder</button>
    </div>
  </div>
{:else}
  <header class="feature-header dash-files-head">
    <div class="path-group">
      <span class="dash-head-label">Files</span>
      <code class="current-path" title={path}>{path}</code>
    </div>
    <div class="actions">
      <button type="button" disabled={!canGoParent || busy} onclick={onGoParent}>Up</button>
      <button type="button" class:active={viewMode === "list"} onclick={() => onViewMode("list")}>List</button>
      <button type="button" class:active={viewMode === "grid"} onclick={() => onViewMode("grid")}>Grid</button>
      {#if onTogglePreview}
        <button type="button" class:active={previewOpen} aria-pressed={previewOpen} disabled={loading} onclick={onTogglePreview}>Preview</button>
      {/if}
      {#if onTriggerUpload}
        <button type="button" disabled={loading || busy} onclick={onTriggerUpload}>Upload</button>
      {/if}
      <button type="button" aria-expanded={creatingFolder} disabled={loading || busy} onclick={onToggleNewFolder}>New folder</button>
      <button type="button" disabled={loading || busy} onclick={onRefresh}>{loading ? "Loading..." : "Refresh"}</button>
    </div>
  </header>
{/if}
