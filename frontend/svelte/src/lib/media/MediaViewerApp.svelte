<script lang="ts">
  import { onMount } from "svelte";
  import { classifyMediaKind, resolveRawMediaUrl, type MediaKind } from "./media-api.ts";
  import { clampZoom, fileNameOf, ZOOM_STEP } from "./media-format.ts";
  import { parentDirectory, readMediaSiblings, siblingIndex, stepSibling, type MediaSibling } from "./media-siblings.ts";
  import MediaStage from "./MediaStage.svelte";
  import MediaToolbar from "./MediaToolbar.svelte";
  import MediaInspector from "./MediaInspector.svelte";

  let { initialPath = "" }: { initialPath?: string } = $props();

  let pathInput = $state("");
  let activePath = $state("");
  let loadError = $state<string | null>(null);
  let mediaError = $state<string | null>(null);
  let zoom = $state(1);
  let rotation = $state(0);
  let showInspector = $state(false);
  let siblings = $state<MediaSibling[]>([]);
  let dimensions = $state<{ width: number; height: number } | null>(null);
  let lastInitial = "";
  let siblingController: AbortController | undefined;
  let generation = 0;

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
  let parentDir = $derived(activePath ? parentDirectory(activePath) : "");
  let currentIndex = $derived(activePath ? siblingIndex(siblings, activePath, fileNameOf(activePath)) : -1);
  let hasSiblings = $derived(siblings.length > 1 && currentIndex >= 0);

  async function loadSiblings(path: string) {
    const run = ++generation;
    siblingController?.abort();
    const ctrl = (siblingController = new AbortController());
    siblings = [];
    if (!path) return;
    try {
      const items = await readMediaSiblings(path, ctrl.signal);
      if (run === generation && !ctrl.signal.aborted) siblings = items;
    } catch {
      if (run === generation && !ctrl.signal.aborted) siblings = [];
    }
  }

  function resetView() {
    zoom = 1;
    rotation = 0;
  }

  function openPath(path: string) {
    const trimmed = path.trim();
    if (!trimmed) {
      loadError = "Enter a file path to preview.";
      return;
    }
    loadError = null;
    mediaError = null;
    dimensions = null;
    resetView();
    activePath = trimmed;
    void loadSiblings(trimmed);
  }

  function submitPath(event: SubmitEvent) {
    event.preventDefault();
    openPath(pathInput);
  }

  function step(delta: number) {
    const next = stepSibling(siblings, activePath, fileNameOf(activePath), delta);
    if (!next) return;
    mediaError = null;
    dimensions = null;
    resetView();
    activePath = next.path;
    pathInput = next.path;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  }

  $effect(() => {
    const next = initialPath.trim();
    if (next && next !== lastInitial) {
      lastInitial = next;
      pathInput = next;
      openPath(next);
    }
  });

  onMount(() => {
    return () => { generation++; siblingController?.abort(); };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<section aria-labelledby="media-viewer-title" data-media-kind={activePath ? mediaKind : "idle"}>
  <header class="feature-header mv-header">
    <div class="mv-title-group">
      <h2 id="media-viewer-title">Media Viewer</h2>
      {#if activePath}<span class="pill">{mediaKind}</span>{/if}
      {#if hasSiblings}<span class="pill">{currentIndex + 1} of {siblings.length}</span>{/if}
    </div>
    <MediaToolbar
      {zoom} {rotation} {mediaKind} {hasSiblings}
      canReset={Boolean(activePath)}
      inspectorOpen={showInspector}
      onZoomOut={() => { zoom = clampZoom(zoom - ZOOM_STEP); }}
      onZoomIn={() => { zoom = clampZoom(zoom + ZOOM_STEP); }}
      onFit={() => { zoom = 1; }}
      onReset={resetView}
      onRotate={() => { rotation = (rotation + 90) % 360; }}
      onPrev={() => step(-1)}
      onNext={() => step(1)}
      onToggleInspector={() => { showInspector = !showInspector; }}
    />
  </header>

  <form class="mv-bar" onsubmit={submitPath}>
    <div class="field mv-input">
      <label for="media-path-input">File path</label>
      <input id="media-path-input" type="text" bind:value={pathInput} placeholder="/path/to/photo.png or ~/audio.mp3" autocomplete="off" />
    </div>
    <button type="submit" class="primary">Open</button>
  </form>

  {#if loadError}<p class="feedback error" role="alert">{loadError}</p>{/if}
  {#if mediaError}<p class="feedback error" role="alert">{mediaError}</p>{/if}

  <div class="mv-layout" class:with-inspector={showInspector}>
    <div class="mv-stage-wrap">
      <div class="mv-stage" role="region" aria-label="Media preview" aria-live="polite" data-kind={activePath ? mediaKind : "idle"}>
        {#if !activePath}
          <p class="mv-hint">Enter a workspace or host file path above, then Open. Use the arrow keys to page through the folder.</p>
        {:else}
          <MediaStage
            path={activePath} {mediaKind} {mediaUrl} {zoom} {rotation}
            onDimensions={(size) => { dimensions = size; }}
            onError={(message) => { mediaError = message; }}
          />
        {/if}
      </div>

      {#if siblings.length > 0}
        <div class="mv-filmstrip" role="group" aria-label={`Files in ${parentDir}`}>
          {#each siblings as item, index (item.path)}
            <button type="button" class="mv-frame" class:current={item.path === activePath}
              aria-current={item.path === activePath ? "true" : undefined} title={item.path}
              onclick={() => openPath(item.path)}>
              <span class="mv-frame-kind">{item.kind}</span>
              <span class="mv-frame-name">{item.name}</span>
              <span class="mv-frame-index">{index + 1}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if showInspector}
      <MediaInspector path={activePath} kind={mediaKind} {dimensions} folderCount={siblings.length}
        onClose={() => { showInspector = false; }} />
    {/if}
  </div>
</section>

<style>
  .mv-header { flex-wrap: wrap; gap: 0.5rem; }
  .mv-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .mv-bar { display: flex; align-items: flex-end; gap: 0.625rem; flex-wrap: wrap; margin: 1rem 0 0.75rem; }
  .mv-input { flex: 1 1 16rem; }
  .mv-layout { display: grid; gap: 0.75rem; min-width: 0; }
  .mv-layout.with-inspector { grid-template-columns: minmax(0, 1fr) minmax(13rem, 17rem); }
  .mv-stage-wrap { display: grid; gap: 0.625rem; min-width: 0; }
  .mv-stage {
    display: grid; place-items: center; padding: 1rem; min-height: 10rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); overflow: auto;
  }
  .mv-stage[data-kind="image"] { background: repeating-conic-gradient(var(--border) 0 25%, transparent 0 50%) 0 0 / 24px 24px; }
  .mv-stage[data-kind="video"], .mv-stage[data-kind="audio"] { background: #0c0d10; place-items: stretch; }
  .mv-hint { margin: 0; font-size: 0.875rem; color: var(--muted); max-width: 34rem; text-align: center; }
  .mv-filmstrip { display: flex; gap: 0.375rem; overflow-x: auto; padding-bottom: 0.25rem; }
  .mv-frame {
    display: grid; gap: 0.125rem; min-width: 6.5rem; max-width: 9rem; padding: 0.375rem 0.5rem;
    text-align: left; background: var(--surface); border-radius: 0.375rem;
  }
  .mv-frame.current { border-color: var(--accent); background: var(--panel); }
  .mv-frame-kind { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .mv-frame-name { font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mv-frame-index { font-size: 0.625rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  @media (max-width: 720px) {
    .mv-layout.with-inspector { grid-template-columns: minmax(0, 1fr); }
  }
</style>
