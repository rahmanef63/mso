<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, listDirectory, type FsEntry, type FsRoot } from "../files/files-api.ts";
  import { joinFsPath } from "./editor-api.ts";

  type TreeNode = {
    path: string; name: string; kind: "dir" | "file";
    depth: number; expanded: boolean; loading: boolean;
  };

  let {
    activePath = null, initialRoot = "~", onOpenFile, onCreateFile, onClose,
  }: {
    activePath?: string | null;
    initialRoot?: string;
    onOpenFile: (path: string) => void;
    onCreateFile: (path: string) => void;
    onClose?: () => void;
  } = $props();

  let rootPath = $state("~");
  let roots = $state<FsRoot[]>([]);
  let entriesByDir = $state<Record<string, FsEntry[]>>({});
  let expanded = $state<Record<string, boolean>>({});
  let loadingDirs = $state<Record<string, boolean>>({});
  let error = $state<string | null>(null);
  let showNewForm = $state(false);
  let newFileInput = $state("");
  let abortCtrl: AbortController | undefined;

  const sortEntries = (entries: FsEntry[]) => [...entries].sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
  );

  async function loadDir(dirPath: string, isRoot = false): Promise<void> {
    loadingDirs = { ...loadingDirs, [dirPath]: true };
    if (isRoot) error = null;
    const ctrl = new AbortController();
    if (isRoot) { abortCtrl?.abort(); abortCtrl = ctrl; }
    try {
      const listed = await listDirectory(dirPath, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const resolved = listed.path || dirPath;
      if (isRoot) {
        rootPath = resolved;
        if (listed.roots && listed.roots.length > 0) roots = listed.roots;
      }
      entriesByDir = { ...entriesByDir, [resolved]: sortEntries(listed.entries) };
    } catch (err) {
      if (ctrl.signal.aborted) return;
      error = err instanceof ApiError ? err.message : "Could not load directory listing.";
    } finally {
      const next = { ...loadingDirs };
      delete next[dirPath];
      loadingDirs = next;
    }
  }

  async function toggleFolder(path: string): Promise<void> {
    const nextOpen = !expanded[path];
    expanded = { ...expanded, [path]: nextOpen };
    if (nextOpen && !entriesByDir[path]) await loadDir(path, false);
  }

  async function refreshTree(): Promise<void> {
    const openDirs = Object.entries(expanded).filter(([, ok]) => ok).map(([dir]) => dir);
    await loadDir(rootPath, true);
    await Promise.all(openDirs.map((dir) => loadDir(dir, false)));
  }

  function handleCreateSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const raw = newFileInput.trim();
    if (!raw) return;
    const resolved = raw.startsWith("/") || raw.startsWith("~") ? raw : joinFsPath(rootPath, raw);
    newFileInput = "";
    showNewForm = false;
    onCreateFile(resolved);
  }

  let visibleNodes = $derived.by(() => {
    const out: TreeNode[] = [];
    const visit = (dir: string, depth: number) => {
      for (const entry of entriesByDir[dir] ?? []) {
        const full = joinFsPath(dir, entry.name);
        const isOpen = Boolean(expanded[full]);
        out.push({
          path: full, name: entry.name, kind: entry.kind, depth,
          expanded: isOpen, loading: Boolean(loadingDirs[full]),
        });
        if (entry.kind === "dir" && isOpen) visit(full, depth + 1);
      }
    };
    visit(rootPath, 0);
    return out;
  });

  onMount(() => {
    rootPath = initialRoot || "~";
    void loadDir(rootPath, true);
    return () => abortCtrl?.abort();
  });
</script>

<aside class="explorer" aria-label="File Explorer">
  <div class="explorer-head">
    <span class="explorer-title">Explorer</span>
    <div class="explorer-actions">
      <button type="button" class="icon-btn" title="New file" aria-label="Create new file" aria-expanded={showNewForm} onclick={() => { showNewForm = !showNewForm; }}>+</button>
      <button type="button" class="icon-btn" title="Refresh file tree" aria-label="Refresh file tree" onclick={() => void refreshTree()}>R</button>
      {#if onClose}
        <button type="button" class="icon-btn mobile-close" title="Hide explorer" aria-label="Hide explorer" onclick={onClose}>x</button>
      {/if}
    </div>
  </div>

  {#if roots.length > 1}
    <div class="root-strip" role="group" aria-label="Workspace roots">
      {#each roots as r (r.path)}
        <button type="button" class="root-pill" class:active={rootPath === r.path} onclick={() => { expanded = {}; entriesByDir = {}; void loadDir(r.path, true); }}>
          {r.label}
        </button>
      {/each}
    </div>
  {/if}

  <div class="root-path" title={rootPath}>{rootPath}</div>

  {#if showNewForm}
    <form class="new-file-form" onsubmit={handleCreateSubmit}>
      <label class="sr-only" for="explorer-new-file">New file path</label>
      <input id="explorer-new-file" type="text" bind:value={newFileInput} placeholder="name.ts or dir/file.md" autocomplete="off" spellcheck={false} />
      <button type="submit" class="primary create-btn">Create</button>
    </form>
  {/if}

  {#if error}
    <p class="explorer-msg error" role="alert">{error}</p>
  {:else if loadingDirs[rootPath] && visibleNodes.length === 0}
    <p class="explorer-msg" role="status">Loading files...</p>
  {:else if visibleNodes.length === 0}
    <p class="explorer-msg">Folder is empty.</p>
  {:else}
    <ul class="tree-list" role="tree" aria-label="Directory contents">
      {#each visibleNodes as node (node.path)}
        <li role="none">
          <button
            type="button"
            role="treeitem"
            aria-expanded={node.kind === "dir" ? node.expanded : undefined}
            aria-selected={node.path === activePath}
            class="tree-row"
            class:is-active={node.path === activePath}
            style={`padding-left: calc(0.5rem + ${node.depth * 0.85}rem)`}
            title={node.path}
            onclick={() => node.kind === "dir" ? void toggleFolder(node.path) : onOpenFile(node.path)}
          >
            <span class="tree-glyph" aria-hidden="true">{node.kind === "dir" ? (node.expanded ? "v" : ">") : "."}</span>
            <span class="tree-name">{node.name}</span>
            {#if node.loading}<span class="tree-meta">...</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .explorer { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--panel); border-right: 1px solid var(--border); }
  .explorer-head { display: flex; align-items: center; justify-content: space-between; gap: 0.375rem; padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--border); }
  .explorer-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .explorer-actions { display: flex; gap: 0.25rem; }
  .icon-btn { min-height: 1.75rem; min-width: 1.75rem; padding: 0.125rem 0.375rem; font-size: 0.75rem; font-family: var(--font-mono); border-radius: 0.375rem; }
  .mobile-close { display: none; }
  .root-strip { display: flex; gap: 0.25rem; flex-wrap: wrap; padding: 0.375rem 0.5rem 0; }
  .root-pill { min-height: 1.5rem; padding: 0.1rem 0.45rem; font-size: 0.7rem; border-radius: 999px; }
  .root-pill.active { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  .root-path { padding: 0.3rem 0.5rem; font-size: 0.72rem; font-family: var(--font-mono); color: var(--muted); border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .new-file-form { display: flex; gap: 0.25rem; padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--border); }
  .new-file-form input { flex: 1 1 auto; min-width: 0; min-height: 1.85rem; padding: 0.2rem 0.4rem; font-size: 0.78rem; font-family: var(--font-mono); }
  .create-btn { min-height: 1.85rem; padding: 0.2rem 0.5rem; font-size: 0.75rem; }
  .tree-list { list-style: none; margin: 0; padding: 0.25rem 0; overflow: auto; flex: 1 1 auto; }
  .tree-row { width: 100%; min-height: 1.85rem; padding: 0.2rem 0.5rem; border: 0; border-radius: 0; background: transparent; color: var(--text); text-align: left; display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; }
  .tree-row:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .tree-row.is-active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); font-weight: 600; }
  .tree-glyph { width: 0.8rem; text-align: center; font-family: var(--font-mono); font-size: 0.72rem; color: var(--muted); flex-shrink: 0; }
  .tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .tree-meta { margin-left: auto; font-size: 0.7rem; color: var(--muted); }
  .explorer-msg { margin: 0.5rem; font-size: 0.78rem; color: var(--muted); }
  .explorer-msg.error { color: var(--danger); }
  @media (max-width: 40rem) {
    .explorer { border-right: 0; border-bottom: 1px solid var(--border); max-height: 14rem; }
    .mobile-close { display: inline-flex; align-items: center; justify-content: center; }
  }
</style>
