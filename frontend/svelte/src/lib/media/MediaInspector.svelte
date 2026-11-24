<script lang="ts">
  import { classifyMediaKind, type MediaKind } from "./media-api.ts";
  import { formatBytes, fileNameOf } from "./media-format.ts";

  let {
    path, kind, dimensions = null, size = null, folderCount = 0, onClose = () => {},
  }: {
    path: string;
    kind: MediaKind;
    dimensions?: { width: number; height: number } | null;
    size?: number | null;
    folderCount?: number;
    onClose?: () => void;
  } = $props();

  let extension = $derived.by(() => {
    const name = fileNameOf(path);
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "(none)";
  });
</script>

<aside class="inspector" aria-label="Media metadata">
  <header class="inspector-head">
    <h3>Metadata</h3>
    <button type="button" onclick={onClose} aria-label="Close metadata panel">Close</button>
  </header>
  <dl>
    <dt>Name</dt>
    <dd>{fileNameOf(path)}</dd>
    <dt>Kind</dt>
    <dd><span class="tag" data-kind={kind}>{kind}</span> <code>.{extension}</code></dd>
    <dt>Path</dt>
    <dd><code class="path">{path}</code></dd>
    <dt>Dimensions</dt>
    <dd>{dimensions ? `${dimensions.width} x ${dimensions.height}` : kind === "image" || kind === "video" ? "Not reported" : "Not applicable"}</dd>
    <dt>Size</dt>
    <dd>{size === null || size === undefined ? "Unknown" : formatBytes(size)}</dd>
    <dt>Folder siblings</dt>
    <dd>{folderCount > 0 ? `${folderCount} previewable file${folderCount === 1 ? "" : "s"}` : "Not listed"}</dd>
    <dt>Resolved kind</dt>
    <dd><code>{classifyMediaKind(path)}</code></dd>
  </dl>
</aside>

<style>
  .inspector {
    display: grid; gap: 0.75rem; align-content: start; min-width: 0;
    padding: 0.875rem; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--panel); max-height: 26rem; overflow-y: auto;
  }
  .inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .inspector-head h3 { margin: 0; font-size: 0.875rem; }
  dl { display: grid; grid-template-columns: minmax(6rem, auto) 1fr; gap: 0.375rem 0.75rem; margin: 0; min-width: 0; }
  dt { font-size: 0.75rem; color: var(--muted); }
  dd { margin: 0; font-size: 0.8125rem; min-width: 0; overflow-wrap: anywhere; }
  .tag { display: inline-block; padding: 0.0625rem 0.375rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.6875rem; }
  .tag[data-kind="image"] { color: var(--ok); border-color: var(--ok); background: var(--ok-bg); }
  .tag[data-kind="error"], .tag[data-kind="unsupported"] { color: var(--warn); border-color: var(--warn); background: var(--warn-bg); }
  .path { font-size: 0.75rem; }
  @media (max-width: 420px) {
    dl { grid-template-columns: 1fr; }
    dt { font-weight: 600; }
  }
</style>
