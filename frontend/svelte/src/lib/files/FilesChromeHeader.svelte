<script lang="ts">
  import type { FilesPresentation } from "../shell/shell-design.ts";

  export type FilesViewMode = "list" | "grid" | "columns";
  export type PathCrumb = { label: string; path: string };

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
    filterText = $bindable(""),
    sidebarOpen = $bindable(false),
    creatingFolder,
    onGoParent,
    onNavigate,
    onViewMode,
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
    filterText: string;
    sidebarOpen: boolean;
    creatingFolder: boolean;
    onGoParent: () => void;
    onNavigate: (p: string) => void;
    onViewMode: (m: FilesViewMode) => void;
    onToggleNewFolder: () => void;
    onRefresh: () => void;
  } = $props();

  let editingPathBar = $state(false);
  let addressInput = $state("");

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
  <header class="finder-toolbar">
    <div class="finder-nav-group">
      <button type="button" class="nav-toggle-btn" aria-expanded={sidebarOpen} onclick={() => { sidebarOpen = !sidebarOpen; }}>Sidebar</button>
      <button type="button" class="finder-icon-btn" aria-label="Go to parent folder" disabled={!canGoParent || busy} onclick={onGoParent}>&#8249;</button>
      <span class="finder-title" title={path}>{folderTitle}</span>
    </div>
    <div class="finder-segment" role="group" aria-label="Finder view mode">
      <button type="button" class:active={viewMode === "list"} aria-pressed={viewMode === "list"} onclick={() => onViewMode("list")}>List</button>
      <button type="button" class:active={viewMode === "grid"} aria-pressed={viewMode === "grid"} onclick={() => onViewMode("grid")}>Icons</button>
      <button type="button" class:active={viewMode === "columns"} aria-pressed={viewMode === "columns"} onclick={() => onViewMode("columns")}>Columns</button>
    </div>
    <div class="finder-actions">
      <button type="button" aria-expanded={creatingFolder} disabled={loading || busy} onclick={onToggleNewFolder}>New folder</button>
      <button type="button" disabled={loading || busy} onclick={onRefresh}>{loading ? "Loading..." : "Refresh"}</button>
    </div>
  </header>
{:else if variant === "explorer"}
  <div class="explorer-chrome">
    <div class="explorer-cmdbar" role="toolbar" aria-label="File Explorer commands">
      <button type="button" class="primary" aria-expanded={creatingFolder} disabled={loading || busy} onclick={onToggleNewFolder}>+ New folder</button>
      <button type="button" class:active={viewMode === "list"} onclick={() => onViewMode("list")}>Details</button>
      <button type="button" class:active={viewMode === "grid"} onclick={() => onViewMode("grid")}>Tiles</button>
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
    <label class="sr-only" for={`${uid}-ios-filter`}>Filter folder</label>
    <input id={`${uid}-ios-filter`} class="ios-files-search" type="search" bind:value={filterText} placeholder={`Search ${folderTitle}`} />
    <div class="ios-files-bar">
      <div class="ios-seg" role="group" aria-label="View style">
        <button type="button" class:active={viewMode === "list"} onclick={() => onViewMode("list")}>List</button>
        <button type="button" class:active={viewMode === "grid"} onclick={() => onViewMode("grid")}>Icons</button>
      </div>
      <button type="button" aria-expanded={creatingFolder} disabled={loading || busy} onclick={onToggleNewFolder}>+ New folder</button>
    </div>
  </div>
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
      <button type="button" aria-expanded={creatingFolder} disabled={loading || busy} onclick={onToggleNewFolder}>New folder</button>
      <button type="button" disabled={loading || busy} onclick={onRefresh}>{loading ? "Loading..." : "Refresh"}</button>
    </div>
  </header>
{/if}
