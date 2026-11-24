<script lang="ts">
  import { exportFormatExtension } from "./image-editor-export.ts";
  import type { ExportFormat } from "./image-editor-state.ts";

  let {
    open,
    outputWidth,
    outputHeight,
    defaultVpsPath,
    savingVps,
    onClose,
    onDownload,
    onSaveToVps,
  }: {
    open: boolean;
    outputWidth: number;
    outputHeight: number;
    defaultVpsPath: string;
    savingVps: boolean;
    onClose: () => void;
    onDownload: (format: ExportFormat, quality: number) => void;
    onSaveToVps: (targetPath: string, format: ExportFormat, quality: number) => void;
  } = $props();

  let format = $state<ExportFormat>("png");
  let quality = $state(90);
  let vpsPath = $state("");

  $effect(() => {
    if (open) {
      vpsPath = defaultVpsPath || `~/Pictures/edited-image.${exportFormatExtension(format)}.dataurl`;
    }
  });

  const FORMATS: readonly { id: ExportFormat; label: string }[] = [
    { id: "png", label: "PNG" },
    { id: "jpeg", label: "JPEG" },
    { id: "webp", label: "WebP" },
  ];

  function submitVpsSave(event: SubmitEvent) {
    event.preventDefault();
    onSaveToVps(vpsPath, format, quality);
  }
</script>

{#if open}
  <div class="modal-layer">
    <button
      type="button"
      class="modal-backdrop"
      aria-label="Close export dialog"
      onclick={onClose}
    ></button>
    <div
      class="modal-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
    >
      <header class="modal-head">
        <h3 id="export-dialog-title">Export Image</h3>
        <button type="button" class="close-btn" onclick={onClose}>Close</button>
      </header>

      <p class="dim-note">Output size: {outputWidth} x {outputHeight} px</p>

      <div class="field">
        <span class="label">Format</span>
        <div class="format-row">
          {#each FORMATS as item (item.id)}
            <button
              type="button"
              class:primary={format === item.id}
              aria-pressed={format === item.id}
              onclick={() => { format = item.id; }}
            >
              {item.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="field">
        <label for="export-quality">
          Quality ({format === "png" ? "Lossless" : `${quality}%`})
        </label>
        <input
          id="export-quality"
          type="range"
          min="10"
          max="100"
          disabled={format === "png"}
          bind:value={quality}
        />
      </div>

      <div class="actions">
        <button type="button" class="primary" onclick={() => onDownload(format, quality)}>
          Download {format.toUpperCase()}
        </button>
      </div>

      <form class="vps-form" onsubmit={submitVpsSave}>
        <div class="field">
          <label for="export-vps-path">Save to VPS path (/api/v1/fs/write)</label>
          <input
            id="export-vps-path"
            type="text"
            bind:value={vpsPath}
            placeholder="~/Pictures/edited-image.png.dataurl"
            autocomplete="off"
          />
        </div>
        <button type="submit" disabled={savingVps || !vpsPath.trim()}>
          {savingVps ? "Saving..." : "Save to VPS"}
        </button>
      </form>
    </div>
  </div>
{/if}

<style>
  .modal-layer {
    position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; padding: 1rem;
  }
  .modal-backdrop {
    position: absolute; inset: 0; border: 0; border-radius: 0; padding: 0;
    background: rgba(0, 0, 0, 0.52); cursor: default;
  }
  .modal-card {
    position: relative; z-index: 1; width: min(27rem, 100%); display: grid; gap: 0.875rem;
    padding: 1.125rem; border: 1px solid var(--border); border-radius: 0.75rem;
    background: var(--panel-solid); box-shadow: var(--shadow-pop);
  }
  .modal-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .close-btn { min-height: 2rem; padding: 0.2rem 0.6rem; font-size: 0.8125rem; }
  .dim-note { margin: 0; font-size: 0.8125rem; font-family: var(--font-mono); color: var(--muted); }
  .label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .format-row { display: flex; gap: 0.4rem; }
  .format-row button { flex: 1 1 0; }
  input[type="range"] { min-height: 1.75rem; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .vps-form { display: grid; gap: 0.5rem; padding-top: 0.65rem; border-top: 1px solid var(--border); }
  .vps-form input[type="text"] { font-family: var(--font-mono); font-size: 0.8125rem; }
</style>
