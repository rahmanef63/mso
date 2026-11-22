<script lang="ts">
  import { classifyMediaKind, resolveRawMediaUrl, type MediaKind } from "./media-api.ts";

  let { initialPath = "" }: { initialPath?: string } = $props();

  let pathInput = $state("");
  let activePath = $state("");
  let loadError = $state<string | null>(null);
  let lastInitial = "";

  $effect(() => {
    const next = initialPath.trim();
    if (next && next !== lastInitial) {
      lastInitial = next;
      pathInput = next;
      activePath = next;
      loadError = null;
    }
  });

  let mediaKind = $derived<MediaKind>(activePath ? classifyMediaKind(activePath) : "unsupported");
  let mediaUrl = $derived.by<string | null>(() => {
    if (!activePath) return null;
    if (mediaKind !== "image" && mediaKind !== "audio" && mediaKind !== "video") return null;
    try {
      return resolveRawMediaUrl(activePath);
    } catch {
      return null;
    }
  });

  function openPath(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = pathInput.trim();
    if (!trimmed) {
      loadError = "Enter a file path to preview.";
      return;
    }
    loadError = null;
    activePath = trimmed;
  }
</script>

<section aria-labelledby="media-viewer-title" data-media-kind={activePath ? mediaKind : "idle"}>
  <header class="feature-header">
    <div class="media-title-group">
      <h2 id="media-viewer-title">Media Viewer</h2>
      {#if activePath}
        <span class="pill">{mediaKind}</span>
      {/if}
    </div>
  </header>

  <form class="media-bar" onsubmit={openPath}>
    <div class="field media-input-field">
      <label for="media-path-input">File path</label>
      <input
        id="media-path-input"
        type="text"
        bind:value={pathInput}
        placeholder="/path/to/photo.png or ~/audio.mp3"
        autocomplete="off"
      />
    </div>
    <button type="submit" class="primary">Open</button>
  </form>

  {#if loadError}
    <p class="feedback error" role="alert">{loadError}</p>
  {/if}

  <div class="media-stage" role="region" aria-label="Media preview" aria-live="polite">
    {#if !activePath}
      <p>Enter a workspace or host file path above and click Open to preview images, audio, or video.</p>
    {:else if mediaKind === "image" && mediaUrl}
      <figure class="media-figure">
        <img
          src={mediaUrl}
          alt={activePath}
          onerror={() => { loadError = "Could not load image. Check the path and file permissions."; }}
        />
        <figcaption><code>{activePath}</code></figcaption>
      </figure>
    {:else if mediaKind === "audio" && mediaUrl}
      <div class="media-player">
        <p class="media-caption"><code>{activePath}</code></p>
        <audio
          controls
          src={mediaUrl}
          onerror={() => { loadError = "Could not load audio stream. Check the path and format."; }}
        ></audio>
      </div>
    {:else if mediaKind === "video" && mediaUrl}
      <div class="media-player">
        <p class="media-caption"><code>{activePath}</code></p>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          controls
          src={mediaUrl}
          onerror={() => { loadError = "Could not load video stream. Check the path and format."; }}
        ></video>
      </div>
    {:else if mediaKind === "text"}
      <p class="feedback pending">
        <code>{activePath}</code> is a text file. Open it in Code Editor for syntax-aware reading and editing.
      </p>
    {:else}
      <p class="feedback pending">
        <code>{activePath}</code> is not a supported image, audio, or video format for inline playback.
      </p>
    {/if}
  </div>
</section>

<style>
  .media-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .media-bar { display: flex; align-items: flex-end; gap: 0.625rem; flex-wrap: wrap; margin: 1rem 0; }
  .media-input-field { flex: 1 1 16rem; }
  .media-stage {
    margin-top: 0.75rem; padding: 1rem; border: 1px solid var(--border);
    border-radius: 0.5rem; background: var(--surface); min-height: 8rem;
  }
  .media-figure { margin: 0; display: grid; gap: 0.625rem; justify-items: center; }
  .media-figure img { max-width: 100%; max-height: 24rem; object-fit: contain; border-radius: 0.375rem; }
  .media-figure figcaption, .media-caption { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .media-player { display: grid; gap: 0.75rem; }
  .media-player audio, .media-player video { width: 100%; max-height: 24rem; border-radius: 0.375rem; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
</style>
