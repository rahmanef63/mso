<script lang="ts">
  import type { Snippet } from "svelte";
  import { bytes } from "../format.ts";
  import type { FilePreviewState } from "./files-controller.ts";
  import { buildRawFileUrl } from "./files-extended-api.ts";
  import {
    entryKindLabel, formatMtime, mediaKindFor, parseMarkdownBlocks,
  } from "./files-meta.ts";

  let {
    uid,
    preview,
    busy,
    editing,
    editPath,
    draft = $bindable(""),
    editorEl = $bindable<HTMLTextAreaElement | undefined>(undefined),
    headerActions,
    editorFooter,
    onCopyPath,
    onClose,
  }: {
    uid: string;
    preview: Exclude<FilePreviewState, { kind: "idle" }>;
    busy: boolean;
    editing: boolean;
    editPath: string | null;
    draft: string;
    editorEl: HTMLTextAreaElement | undefined;
    headerActions?: Snippet;
    editorFooter?: Snippet;
    onCopyPath: (path: string) => void;
    onClose: () => void;
  } = $props();

  let mdFormatted = $state(true);
  let mediaKind = $derived(
    preview.kind === "ready"
      ? (preview.mediaKind ?? mediaKindFor(preview.entry ?? preview.name))
      : mediaKindFor(preview.name),
  );
  let rawUrl = $derived.by(() => {
    try {
      return buildRawFileUrl(preview.path);
    } catch {
      return "";
    }
  });
  let mdBlocks = $derived(
    preview.kind === "ready" && mediaKind === "markdown"
      ? parseMarkdownBlocks(preview.content)
      : [],
  );
  let lineCount = $derived(
    preview.kind === "ready" && preview.content
      ? preview.content.split("\n").length
      : 0,
  );
  let metaKind = $derived(
    preview.kind === "ready" && preview.entry
      ? entryKindLabel(preview.entry)
      : entryKindLabel({ name: preview.name, kind: "file" }),
  );
  let metaSize = $derived(
    preview.kind === "ready" && preview.entry
      ? bytes(preview.entry.size)
      : preview.kind === "ready"
        ? bytes(new TextEncoder().encode(preview.content).byteLength)
        : "-",
  );
  let metaMtime = $derived(
    preview.kind === "ready" && preview.entry ? formatMtime(preview.entry.mtime) : "-",
  );
</script>

<aside class="preview-pane" aria-label={`Preview of ${preview.name}`} data-quick-look>
  <header class="preview-header">
    <div class="preview-meta">
      <strong>{preview.name}</strong>
      <code title={preview.path}>{preview.path}</code>
    </div>
    <div class="preview-actions">
      <button type="button" class="compact-btn" onclick={() => onCopyPath(preview.path)}>Copy path</button>
      {#if rawUrl}
        <a class="compact-link" href={rawUrl} download={preview.name}>Download</a>
      {/if}
      {#if headerActions}
        {@render headerActions()}
      {/if}
      <button type="button" class="compact-btn" disabled={busy} onclick={onClose}>Close preview</button>
    </div>
  </header>

  <dl class="ql-meta-strip">
    <div><dt>Kind</dt><dd>{metaKind}</dd></div>
    <div><dt>Size</dt><dd>{metaSize}</dd></div>
    <div><dt>Modified</dt><dd>{metaMtime}</dd></div>
    {#if preview.kind === "ready" && (mediaKind === "code" || mediaKind === "text" || mediaKind === "markdown")}
      <div><dt>Lines</dt><dd>{lineCount}</dd></div>
    {/if}
  </dl>

  {#if preview.kind === "loading"}
    <p class="files-status" role="status" aria-live="polite">Reading file...</p>
  {:else if preview.kind === "error"}
    <p class="feedback error" role="alert">{preview.message}</p>
  {:else if editing && editPath === preview.path}
    <div class="editor-wrap">
      <label class="sr-only" for={`${uid}-editor`}>Edit {preview.name}</label>
      <textarea
        id={`${uid}-editor`}
        class="preview-editor"
        bind:value={draft}
        bind:this={editorEl}
        disabled={busy}
        rows="14"
      ></textarea>
      {#if editorFooter}
        {@render editorFooter()}
      {/if}
    </div>
  {:else if mediaKind === "image" && rawUrl}
    <div class="ql-media-stage">
      <img class="ql-image" src={rawUrl} alt={preview.name} />
    </div>
  {:else if mediaKind === "audio" && rawUrl}
    <div class="ql-media-stage">
      <audio class="ql-audio" controls src={rawUrl}>
        Your browser does not support audio playback.
      </audio>
    </div>
  {:else if mediaKind === "video" && rawUrl}
    <div class="ql-media-stage">
      <video class="ql-video" controls src={rawUrl}>
        <track kind="captions" />
      </video>
    </div>
  {:else if mediaKind === "binary"}
    <div class="ql-binary-card">
      <p>Binary preview is not shown inline for this file type.</p>
      {#if rawUrl}
        <a class="zip-download-link" href={rawUrl} download={preview.name}>Download {preview.name}</a>
      {/if}
    </div>
  {:else if mediaKind === "markdown"}
    <div class="ql-md-toolbar">
      <button type="button" class="compact-btn" class:active={mdFormatted} onclick={() => { mdFormatted = true; }}>
        Formatted
      </button>
      <button type="button" class="compact-btn" class:active={!mdFormatted} onclick={() => { mdFormatted = false; }}>
        Source
      </button>
    </div>
    {#if mdFormatted}
      <div class="ql-markdown" data-markdown-preview>
        {#each mdBlocks as block, idx (idx)}
          {#if block.kind === "heading"}
            <p class={`ql-md-h ql-md-h${Math.min(block.level, 4)}`}>{block.text}</p>
          {:else if block.kind === "code"}
            <pre class="preview-code"><code>{block.text}</code></pre>
          {:else if block.kind === "quote"}
            <blockquote class="ql-md-quote">{block.text}</blockquote>
          {:else if block.kind === "list"}
            <ul class="ql-md-list">
              {#each block.items as item, itemIdx (itemIdx)}
                <li>{item}</li>
              {/each}
            </ul>
          {:else}
            <p class="ql-md-p">{block.text}</p>
          {/if}
        {/each}
      </div>
    {:else}
      <pre class="preview-code"><code>{preview.content}</code></pre>
    {/if}
  {:else}
    <pre class="preview-code"><code>{preview.content}</code></pre>
  {/if}
</aside>
