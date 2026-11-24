<script lang="ts">
  import "./ImageEditorApp.css";
  import { classifyMediaKind, resolveRawMediaUrl } from "../media/media-api.ts";
  import {
    buildCssFilter, buildCssTransform, clampPercent, defaultAdjustments, rotateRight,
    type ImageAdjustments,
  } from "./creative-state.ts";

  let { initialPath = "" }: { initialPath?: string } = $props();
  let pathInput = $state("");
  let activePath = $state("");
  let adjustments = $state<ImageAdjustments>(defaultAdjustments());
  let imageLoaded = $state(false);
  let feedback = $state<string | null>(null);
  let feedbackKind = $state<"error" | "ok" | "pending">("pending");
  let exportedJson = $state<string | null>(null);
  let imgEl = $state<HTMLImageElement | null>(null);
  let lastInitial = "";

  $effect(() => {
    const next = initialPath.trim();
    if (next && next !== lastInitial) {
      lastInitial = next;
      pathInput = next;
      activePath = next;
      imageLoaded = false;
      feedback = null;
      exportedJson = null;
    }
  });

  let mediaKind = $derived(activePath ? classifyMediaKind(activePath) : "unsupported");
  let imageUrl = $derived.by<string | null>(() => {
    if (!activePath || mediaKind !== "image") return null;
    try { return resolveRawMediaUrl(activePath); } catch { return null; }
  });
  let cssFilter = $derived(buildCssFilter(adjustments));
  let cssTransform = $derived(buildCssTransform(adjustments));

  function setStatus(kind: "error" | "ok" | "pending", message: string) {
    feedbackKind = kind;
    feedback = message;
  }

  function loadImage(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = pathInput.trim();
    if (!trimmed) {
      setStatus("error", "Enter an image file path to load.");
      return;
    }
    activePath = trimmed;
    imageLoaded = false;
    exportedJson = null;
    if (classifyMediaKind(trimmed) !== "image") {
      setStatus("pending", "Selected path is not a supported image extension.");
      return;
    }
    feedback = null;
  }

  function resetAll() {
    adjustments = defaultAdjustments();
    exportedJson = null;
    setStatus("ok", "Reset all image adjustments to defaults.");
  }

  function exportSettingsJson() {
    const payload = JSON.stringify({
      path: activePath || null,
      adjustments,
      cssFilter,
      cssTransform,
    }, null, 2);
    exportedJson = payload;
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "image-adjustments.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("ok", "Exported adjustments JSON.");
  }

  function exportCanvasPng() {
    if (!imgEl || !imageLoaded || imgEl.naturalWidth === 0) {
      setStatus("error", "Load a valid image before exporting PNG.");
      return;
    }
    const quarterTurn = adjustments.rotateDeg === 90 || adjustments.rotateDeg === 270;
    const w = quarterTurn ? imgEl.naturalHeight : imgEl.naturalWidth;
    const h = quarterTurn ? imgEl.naturalWidth : imgEl.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setStatus("error", "Canvas 2D context is unavailable.");
      return;
    }
    try {
      ctx.filter = cssFilter;
      ctx.translate(w / 2, h / 2);
      ctx.rotate((adjustments.rotateDeg * Math.PI) / 180);
      ctx.scale(adjustments.flipH ? -1 : 1, adjustments.flipV ? -1 : 1);
      ctx.drawImage(imgEl, -imgEl.naturalWidth / 2, -imgEl.naturalHeight / 2);
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = "edited-image.png";
      link.click();
      setStatus("ok", "Downloaded edited PNG from canvas.");
    } catch {
      setStatus("error", "Could not export PNG due to browser canvas restrictions. Use Export JSON instead.");
    }
  }
</script>

<section aria-labelledby="image-editor-title" data-image-loaded={imageLoaded ? "true" : "false"}>
  <header class="feature-header">
    <h2 id="image-editor-title">Image Editor</h2>
    <span class="role-badge">{adjustments.rotateDeg} deg</span>
  </header>

  <form class="editor-bar" onsubmit={loadImage}>
    <div class="field grow">
      <label for="img-editor-path">Host image path</label>
      <input id="img-editor-path" type="text" bind:value={pathInput} placeholder="/path/to/photo.png" autocomplete="off" />
    </div>
    <button type="submit" class="primary">Load</button>
  </form>

  {#if feedback}
    <p class="feedback {feedbackKind}" role={feedbackKind === "error" ? "alert" : "status"}>{feedback}</p>
  {/if}

  <div class="editor-layout">
    <div class="stage" role="region" aria-label="Image preview stage">
      {#if imageUrl}
        <img bind:this={imgEl} src={imageUrl} alt={activePath} style="filter: {cssFilter}; transform: {cssTransform};" onload={() => { imageLoaded = true; feedback = null; }} onerror={() => { imageLoaded = false; setStatus("error", "Could not load image from host path."); }}
        />
      {:else}
        <p class="placeholder">Enter a host image path above and click Load to edit.</p>
      {/if}
    </div>

    <div class="controls">
      <div class="field">
        <label for="slider-brightness">Brightness ({adjustments.brightness}%)</label>
        <input id="slider-brightness" type="range" min="50" max="150" value={adjustments.brightness}
          oninput={(e) => { adjustments.brightness = clampPercent(Number(e.currentTarget.value), 50, 150); }} />
      </div>
      <div class="field">
        <label for="slider-contrast">Contrast ({adjustments.contrast}%)</label>
        <input id="slider-contrast" type="range" min="50" max="150" value={adjustments.contrast}
          oninput={(e) => { adjustments.contrast = clampPercent(Number(e.currentTarget.value), 50, 150); }} />
      </div>
      <div class="field">
        <label for="slider-saturate">Saturation ({adjustments.saturate}%)</label>
        <input id="slider-saturate" type="range" min="0" max="200" value={adjustments.saturate}
          oninput={(e) => { adjustments.saturate = clampPercent(Number(e.currentTarget.value), 0, 200); }} />
      </div>

      <div class="actions">
        <button type="button" onclick={() => { adjustments.rotateDeg = rotateRight(adjustments.rotateDeg); }}>Rotate 90</button>
        <button type="button" aria-pressed={adjustments.flipH} class:primary={adjustments.flipH}
          onclick={() => { adjustments.flipH = !adjustments.flipH; }}>Flip H</button>
        <button type="button" aria-pressed={adjustments.flipV} class:primary={adjustments.flipV}
          onclick={() => { adjustments.flipV = !adjustments.flipV; }}>Flip V</button>
        <button type="button" onclick={resetAll}>Reset</button>
      </div>

      <div class="actions">
        <button type="button" class="primary" disabled={!imageLoaded} onclick={exportCanvasPng}>Export PNG</button>
        <button type="button" onclick={exportSettingsJson}>Export JSON</button>
      </div>
    </div>
  </div>

  {#if exportedJson}
    <pre class="json-summary" aria-label="Exported settings summary">{exportedJson}</pre>
  {/if}
</section>
