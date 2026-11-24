<script lang="ts">
  import "./ImagePickerPanel.css";
  import { onDestroy } from "svelte";
  import { listDirectory, type FsEntry } from "../files/files-api.ts";
  import { ApiError, classifyMediaKind, resolveRawMediaUrl, searchStockImages, type StockImageItem } from "./media-api.ts";
  import { formatBytes, fileNameOf } from "./media-format.ts";
  import { joinPath } from "./media-siblings.ts";
  import ImageResultGrid from "./ImageResultGrid.svelte";
  import type { ImageGridItem } from "./media-format.ts";

  let { onNotice = () => {} }: { onNotice?: (message: string) => void } = $props();

  type Source = "folder" | "stock";
  type FolderState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; path: string; images: FsEntry[]; parent: string | null; total: number }
    | { kind: "error"; message: string };
  type StockState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; items: StockImageItem[]; page: number; query: string }
    | { kind: "error"; message: string };

  let source = $state<Source>("folder");
  let folderPath = $state("~");
  let folder = $state<FolderState>({ kind: "idle" });
  let stockQuery = $state("");
  let stock = $state<StockState>({ kind: "idle" });
  let selectedKey = $state<string | null>(null);
  let selectedLabel = $state("");
  let folderController: AbortController | undefined;
  let stockController: AbortController | undefined;

  let folderItems = $derived.by<ImageGridItem[]>(() => {
    if (folder.kind !== "ready") return [];
    return folder.images.map((entry) => {
      const path = joinPath(folder.kind === "ready" ? folder.path : "~", entry.name);
      let thumb = "";
      try {
        thumb = resolveRawMediaUrl(path);
      } catch {
        thumb = "";
      }
      return { key: path, thumb, name: entry.name, meta: formatBytes(entry.size) };
    }).filter((item) => item.thumb.length > 0);
  });

  let stockItems = $derived.by<ImageGridItem[]>(() => {
    if (stock.kind !== "ready") return [];
    return stock.items.map((item) => ({
      key: item.url,
      thumb: item.thumb,
      name: item.title || "Untitled photo",
      meta: `${item.creator || "Unknown creator"}${item.license ? ` (${item.license})` : ""}`,
    }));
  });

  async function browse(path: string) {
    folderController?.abort();
    const ctrl = (folderController = new AbortController());
    folder = { kind: "loading" };
    folderPath = path;
    selectedKey = null;
    try {
      const listing = await listDirectory(path || "~", ctrl.signal);
      if (ctrl.signal.aborted) return;
      const files = listing.entries.filter(
        (entry) => entry.kind === "file" && classifyMediaKind(entry.name) === "image",
      );
      folder = {
        kind: "ready", path: listing.path || path, images: files,
        parent: listing.parent ?? null, total: listing.entries.length,
      };
    } catch (error) {
      if (ctrl.signal.aborted) return;
      folder = { kind: "error", message: error instanceof ApiError ? error.message : "Could not list that folder." };
    }
  }

  function submitFolder(event: SubmitEvent) {
    event.preventDefault();
    void browse(folderPath.trim() || "~");
  }

  async function runStock(query: string, page: number) {
    const trimmed = query.trim();
    if (!trimmed) {
      stock = { kind: "error", message: "Enter a search query to browse stock images." };
      return;
    }
    stockController?.abort();
    const ctrl = (stockController = new AbortController());
    stock = { kind: "loading" };
    selectedKey = null;
    try {
      const data = await searchStockImages(trimmed, page, ctrl.signal);
      if (!ctrl.signal.aborted) stock = { kind: "ready", items: data.results, page, query: trimmed };
    } catch (error) {
      if (ctrl.signal.aborted) return;
      stock = { kind: "error", message: error instanceof ApiError ? error.message : "Could not search stock images." };
    }
  }

  function submitStock(event: SubmitEvent) {
    event.preventDefault();
    void runStock(stockQuery, 1);
  }

  async function copy(value: string, label: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        onNotice(`Copied ${label}.`);
        return;
      }
    } catch {
      // Clipboard denied; show the value instead.
    }
    onNotice(`${label}: ${value}`);
  }

  function select(item: ImageGridItem) {
    selectedKey = item.key;
    selectedLabel = item.name;
  }

  onDestroy(() => {
    folderController?.abort();
    stockController?.abort();
  });
</script>

<div class="image-picker">
  <div class="source-row" role="tablist" aria-label="Image source">
    <button type="button" role="tab" aria-selected={source === "folder"} class:active={source === "folder"}
      onclick={() => { source = "folder"; }}>VPS Folder</button>
    <button type="button" role="tab" aria-selected={source === "stock"} class:active={source === "stock"}
      onclick={() => { source = "stock"; }}>Stock Search</button>
  </div>

  {#if source === "folder"}
    <form class="bar" onsubmit={submitFolder}>
      <div class="field grow">
        <label for="image-folder-path">Folder path</label>
        <input id="image-folder-path" type="text" bind:value={folderPath} placeholder="~/Pictures or /srv/assets" autocomplete="off" />
      </div>
      <button type="submit" class="primary" disabled={folder.kind === "loading"}>
        {folder.kind === "loading" ? "Listing..." : "Browse"}
      </button>
    </form>

    <div role="status" aria-live="polite">
      {#if folder.kind === "idle"}
        <p class="hint">Browse a folder on the host and copy an absolute path for any image.</p>
      {:else if folder.kind === "loading"}
        <p class="hint">Listing images in {folderPath}...</p>
      {:else if folder.kind === "error"}
        <p class="feedback error" role="alert">{folder.message}</p>
      {:else}
        <div class="path-row">
          <code>{folder.path}</code>
          <span class="muted">{folder.images.length} image{folder.images.length === 1 ? "" : "s"} of {folder.total} entries</span>
          {#if folder.parent}<button type="button" onclick={() => void browse(folder.kind === "ready" ? (folder.parent ?? "~") : "~")}>Up one level</button>{/if}
        </div>
        {#if folderItems.length === 0}
          <p class="hint">No images in this folder. Try a parent directory.</p>
        {:else}
          <ImageResultGrid items={folderItems} label="Folder images" {selectedKey} onSelect={select}
            onCopy={(value, notice) => void copy(value, notice)} copyLabel="Copy Path" />
        {/if}
      {/if}
    </div>
  {:else}
    <form class="bar" onsubmit={submitStock}>
      <div class="field grow">
        <label for="stock-image-query">Search stock images</label>
        <input id="stock-image-query" type="search" bind:value={stockQuery} placeholder="Workspace, architecture, texture" />
      </div>
      <button type="submit" class="primary" disabled={stock.kind === "loading"}>
        {stock.kind === "loading" ? "Searching..." : "Search"}
      </button>
    </form>

    <div role="status" aria-live="polite">
      {#if stock.kind === "idle"}
        <p class="hint">Results include creator and license attribution. Copy a URL for use elsewhere in the shell.</p>
      {:else if stock.kind === "loading"}
        <p class="hint">Searching stock providers...</p>
      {:else if stock.kind === "error"}
        <p class="feedback error" role="alert">{stock.message}</p>
      {:else if stock.items.length === 0}
        <p class="hint">No stock images found for "{stock.query}".</p>
      {:else}
        {@const readyQuery = stock.query}
        {@const readyPage = stock.page}
        <ImageResultGrid items={stockItems} label="Stock image results" {selectedKey} onSelect={select}
          onCopy={(value, notice) => void copy(value, notice)} copyLabel="Copy URL" />
        <div class="pager">
          <button type="button" disabled={readyPage <= 1} onclick={() => void runStock(readyQuery, readyPage - 1)}>Previous</button>
          <span class="muted">Page {readyPage}</span>
          <button type="button" onclick={() => void runStock(readyQuery, readyPage + 1)}>Next</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if selectedKey}
    <div class="selected-card">
      <img src={selectedKey} alt={selectedLabel} />
      <div class="selected-meta">
        <strong>{selectedLabel || "Selected image"}</strong>
        <code>{fileNameOf(selectedKey)}</code>
        <div class="selected-actions">
          <button type="button" onclick={() => void copy(selectedKey ?? "", "image URL")}>Copy URL</button>
          <button type="button" onclick={() => { selectedKey = null; selectedLabel = ""; }}>Clear</button>
        </div>
      </div>
    </div>
  {/if}
</div>
