<script lang="ts">
  import { bytes } from "../format.ts";
  import type { FilesPresentation } from "../shell/shell-design.ts";
  import type { PathCrumb } from "./FilesChromeHeader.svelte";
  import type { FsUsageInfo } from "./files-extended-api.ts";

  const PLACE_GLYPHS = ["g-folder-fill", "g-disk", "g-share", "g-clock"] as const;

  let {
    mode,
    variant,
    currentPath,
    parent,
    parentTitle,
    sidebarOpen = false,
    pathSegments = [],
    roots = [],
    itemCount = 0,
    selectedCount = 0,
    selectedName = null,
    diskUsage = null,
    usageLoading = false,
    onRefreshUsage,
    onNavigate,
    onGoParent,
  }: {
    mode: "sidebar" | "footer";
    variant: FilesPresentation;
    currentPath: string;
    parent: string | null;
    parentTitle: string;
    sidebarOpen?: boolean;
    pathSegments?: readonly PathCrumb[];
    roots?: readonly { label: string; path: string }[];
    itemCount?: number;
    selectedCount?: number;
    selectedName?: string | null;
    diskUsage?: FsUsageInfo | null;
    usageLoading?: boolean;
    onRefreshUsage?: () => void;
    onNavigate: (p: string) => void;
    onGoParent: () => void;
  } = $props();

  let usageLabel = $derived.by(() => {
    if (!diskUsage) return "Not checked";
    if (diskUsage.kind === "disk") {
      return `${bytes(diskUsage.used)} / ${bytes(diskUsage.total)}`;
    }
    return `${bytes(diskUsage.bytes)} (${diskUsage.files} files)`;
  });

  let usagePct = $derived(
    diskUsage?.kind === "disk" ? Math.round(diskUsage.ratio * 100) : null,
  );
</script>

{#if mode === "sidebar"}
  <aside
    class="files-sidebar"
    class:open={sidebarOpen}
    aria-label={variant === "finder" ? "Finder Favorites" : "Quick access"}
  >
    <p class="sidebar-group-title">{variant === "finder" ? "Favorites" : "Quick access"}</p>
    {#each roots as place, i (place.path)}
      <button
        type="button"
        class="place-item"
        class:active={currentPath === place.path}
        onclick={() => onNavigate(place.path)}
      >
        <span class="place-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24"><use href={`#${PLACE_GLYPHS[i % PLACE_GLYPHS.length]}`} /></svg>
        </span>
        <span>{place.label}</span>
      </button>
    {/each}
    {#if parent}
      <button type="button" class="place-item" onclick={onGoParent}>
        <span class="place-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24"><use href="#g-chevron-left" /></svg>
        </span>
        <span>Parent ({parentTitle})</span>
      </button>
    {/if}

    <div class="sidebar-usage" data-disk-usage>
      <div class="usage-head">
        <span class="sidebar-group-title">Storage</span>
        {#if onRefreshUsage}
          <button
            type="button"
            class="usage-refresh-btn"
            disabled={usageLoading}
            onclick={onRefreshUsage}
          >
            {usageLoading ? "..." : diskUsage ? "Refresh" : "Check"}
          </button>
        {/if}
      </div>
      {#if usagePct !== null}
        <div class="usage-track" role="progressbar" aria-label="Disk usage" aria-valuenow={usagePct} aria-valuemin={0} aria-valuemax={100}>
          <div class="usage-fill" style={`width: ${usagePct}%`}></div>
        </div>
      {/if}
      <p class="usage-text">{usageLabel}</p>
    </div>
  </aside>
{:else if variant === "finder"}
  <footer class="finder-pathbar" aria-label="Finder path bar">
    <div class="finder-crumbs">
      {#each pathSegments as crumb, i (crumb.path)}
        {#if i > 0}<span class="crumb-sep" aria-hidden="true">&#8250;</span>{/if}
        <button type="button" class="crumb-btn" onclick={() => onNavigate(crumb.path)}>
          {crumb.label}
        </button>
      {/each}
    </div>
    <div class="footer-meta">
      <span class="status-count">{itemCount} items</span>
      {#if selectedCount > 0}<span class="status-count">{selectedCount} selected</span>{/if}
      {#if diskUsage}<span class="status-usage" data-footer-usage>{usageLabel}</span>{/if}
    </div>
  </footer>
{:else if variant === "explorer"}
  <footer class="explorer-statusbar">
    <span>{itemCount} items</span>
    {#if selectedCount > 1}
      <span>{selectedCount} selected</span>
    {:else if selectedName}
      <span>Selected: {selectedName}</span>
    {/if}
    {#if diskUsage}<span class="status-usage" data-footer-usage>{usageLabel}</span>{/if}
  </footer>
{:else}
  <footer class="files-compact-footer" aria-label="Folder summary">
    <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
    {#if selectedCount > 0}<span>{selectedCount} selected</span>{/if}
    <span class="compact-usage" data-disk-usage>
      {#if usagePct !== null}
        <span class="usage-inline-track" aria-hidden="true">
          <span class="usage-fill" style={`width: ${usagePct}%`}></span>
        </span>
      {/if}
      <span>{diskUsage ? usageLabel : "Storage"}</span>
      {#if onRefreshUsage}
        <button type="button" class="usage-refresh-btn" disabled={usageLoading} onclick={onRefreshUsage}>
          {usageLoading ? "..." : diskUsage ? "Refresh" : "Check"}
        </button>
      {/if}
    </span>
  </footer>
{/if}
