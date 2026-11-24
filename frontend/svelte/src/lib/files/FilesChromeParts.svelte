<script lang="ts">
  import type { FilesPresentation } from "../shell/shell-design.ts";
  import type { PathCrumb } from "./FilesChromeHeader.svelte";

  const PLACES = [
    { label: "Home", path: "~", glyph: "H" },
    { label: "Root", path: "/", glyph: "/" },
  ];

  let {
    mode,
    variant,
    currentPath,
    parent,
    parentTitle,
    sidebarOpen = false,
    pathSegments = [],
    itemCount = 0,
    selectedName = null,
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
    itemCount?: number;
    selectedName?: string | null;
    onNavigate: (p: string) => void;
    onGoParent: () => void;
  } = $props();
</script>

{#if mode === "sidebar"}
  <aside
    class="files-sidebar"
    class:open={sidebarOpen}
    aria-label={variant === "finder" ? "Finder Favorites" : "Quick access"}
  >
    <p class="sidebar-group-title">{variant === "finder" ? "Favorites" : "Quick access"}</p>
    {#each PLACES as place (place.path)}
      <button
        type="button"
        class="place-item"
        class:active={currentPath === place.path}
        onclick={() => onNavigate(place.path)}
      >
        <span class="place-glyph" aria-hidden="true">{place.glyph}</span>
        <span>{place.label}</span>
      </button>
    {/each}
    {#if parent}
      <button type="button" class="place-item" onclick={onGoParent}>
        <span class="place-glyph" aria-hidden="true">..</span>
        <span>Parent ({parentTitle})</span>
      </button>
    {/if}
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
    <span class="status-count">{itemCount} items</span>
  </footer>
{:else if variant === "explorer"}
  <footer class="explorer-statusbar">
    <span>{itemCount} items</span>
    {#if selectedName}<span>Selected: {selectedName}</span>{/if}
  </footer>
{/if}
