<script lang="ts">
  import { resolveRawMediaUrl, type MediaKind } from "./media-api.ts";
  import { fileNameOf } from "./media-format.ts";
  import MediaPlayback from "./MediaPlayback.svelte";

  let {
    path, mediaKind, mediaUrl, zoom, rotation, onDimensions, onError,
  }: {
    path: string;
    mediaKind: MediaKind;
    mediaUrl: string | null;
    zoom: number;
    rotation: number;
    onDimensions: (size: { width: number; height: number }) => void;
    onError: (message: string) => void;
  } = $props();

  let ext = $derived.by(() => {
    const name = fileNameOf(path);
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "bin";
  });
  let downloadHref = $derived.by<string | null>(() => {
    if (mediaUrl) return mediaUrl;
    if (!path) return null;
    try {
      return resolveRawMediaUrl(path);
    } catch {
      return null;
    }
  });
</script>

{#if mediaKind === "image" && mediaUrl}
  <figure class="mv-figure">
    <img
      src={mediaUrl}
      alt={fileNameOf(path)}
      style={`transform: scale(${zoom}) rotate(${rotation}deg);`}
      onload={(event) => {
        const img = event.currentTarget as HTMLImageElement;
        if (img.naturalWidth > 0) onDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      }}
      onerror={() => onError("Could not load image. Check the path and file permissions.")}
    />
    <figcaption><code>{path}</code></figcaption>
  </figure>
{:else if (mediaKind === "video" || mediaKind === "audio") && mediaUrl}
  <p class="mv-caption"><code>{path}</code></p>
  {#key path}
    <MediaPlayback src={mediaUrl} name={fileNameOf(path)} kind={mediaKind} {onError} />
  {/key}
{:else if mediaKind === "text"}
  <p class="feedback pending"><code>{path}</code> is a text file. Open it in Code Editor for syntax-aware reading and editing.</p>
{:else}
  <div class="mv-fallback">
    <strong>{fileNameOf(path)}</strong>
    <p>No browser can render .{ext} inline. Download it, or open it in an app that handles the format.</p>
    {#if downloadHref}
      <a class="mv-download" href={downloadHref} download={fileNameOf(path)}>Download file</a>
    {/if}
  </div>
{/if}

<style>
  .mv-figure { margin: 0; display: grid; gap: 0.625rem; justify-items: center; min-width: 0; }
  .mv-figure img { max-width: 100%; max-height: 26rem; object-fit: contain; border-radius: 0.375rem; transition: transform 160ms ease; }
  .mv-figure figcaption, .mv-caption { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .mv-caption { color: #d6d8e0; }
  .mv-fallback { display: grid; gap: 0.5rem; justify-items: center; text-align: center; padding: 1.5rem 1rem; max-width: 30rem; }
  .mv-fallback p { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .mv-download {
    display: inline-flex; align-items: center; min-height: var(--ui-control-height); padding: 0.5rem 0.875rem;
    border: 1px solid var(--accent); border-radius: 0.375rem; background: var(--accent); color: var(--accent-text);
    font-size: 0.8125rem; font-weight: 600; text-decoration: none;
  }
</style>
