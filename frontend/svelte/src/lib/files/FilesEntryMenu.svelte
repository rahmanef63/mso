<script lang="ts">
  import { buildRawFileUrl } from "./files-extended-api.ts";
  import { joinFsPath } from "./files-path-utils.ts";
  import type { FsEntryMeta } from "./files-api.ts";

  let {
    entry,
    dirPath,
    busy,
    open,
    onToggle,
    onClose,
    onOpen,
    onPreview,
    onRename,
    onCopyPath,
    onZip,
    onDelete,
  }: {
    entry: FsEntryMeta;
    dirPath: string;
    busy: boolean;
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    onOpen: () => void;
    onPreview: () => void;
    onRename: () => void;
    onCopyPath: () => void;
    onZip: () => void;
    onDelete: () => void;
  } = $props();

  let fullPath = $derived(joinFsPath(dirPath, entry.name));
  let downloadHref = $derived(entry.kind === "file" ? buildRawFileUrl(fullPath) : "");

  function runAction(fn: () => void) {
    onClose();
    fn();
  }

  function onMenuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }
</script>

<div class="entry-menu-wrap" onkeydown={onMenuKeydown}>
  <button
    type="button"
    class="entry-menu-btn"
    disabled={busy}
    aria-haspopup="true"
    aria-expanded={open}
    aria-label={`Actions for ${entry.name}`}
    data-entry-menu={entry.name}
    onclick={(e) => { e.stopPropagation(); onToggle(); }}
  >
    ...
  </button>

  {#if open}
    <div class="entry-menu-pop" role="region" aria-label={`Actions menu for ${entry.name}`}>
      <button type="button" class="menu-item" onclick={() => runAction(onOpen)}>Open</button>
      {#if entry.kind === "file"}
        <button type="button" class="menu-item" onclick={() => runAction(onPreview)}>Preview</button>
      {/if}
      <button type="button" class="menu-item" onclick={() => runAction(onRename)}>Rename</button>
      <button type="button" class="menu-item" onclick={() => runAction(onCopyPath)}>Copy path</button>
      {#if entry.kind === "file"}
        <a
          class="menu-item menu-link"
          href={downloadHref}
          download={entry.name}
          onclick={() => onClose()}
        >
          Download
        </a>
      {/if}
      <button type="button" class="menu-item" onclick={() => runAction(onZip)}>
        {entry.kind === "dir" ? "Download as Zip" : "Zip archive"}
      </button>
      <button type="button" class="menu-item danger" onclick={() => runAction(onDelete)}>Delete</button>
    </div>
  {/if}
</div>
