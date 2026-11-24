<script lang="ts">
  import type { PreviewDevice } from "./demo-adapter.ts";

  type ViewportOption = {
    readonly id: PreviewDevice;
    readonly label: string;
    readonly widthHint: string;
  };

  const VIEWPORT_OPTIONS: readonly ViewportOption[] = [
    { id: "desktop", label: "Desktop", widthHint: "1440px" },
    { id: "tablet", label: "Tablet", widthHint: "820px" },
    { id: "phone", label: "Phone", widthHint: "390px" },
  ];

  function resolveDefaultSha(): string {
    try {
      const sha = (globalThis as Record<string, unknown>).__MSO_BUILD_SHA__;
      if (typeof sha === "string" && sha.trim()) return sha.trim();
    } catch { /* ignore */ }
    return "dev";
  }

  let {
    visible = true,
    buildSha = resolveDefaultSha(),
    previewDevice = "desktop",
    onPreviewDeviceChange,
  }: {
    visible?: boolean;
    buildSha?: string;
    previewDevice?: PreviewDevice;
    onPreviewDeviceChange?: (device: PreviewDevice) => void;
  } = $props();

  let displaySha = $derived(buildSha.trim() || "dev");

  function selectDevice(device: PreviewDevice) {
    if (device !== previewDevice) onPreviewDeviceChange?.(device);
  }
</script>

{#if visible}
  <aside class="demo-banner" role="region" aria-label="Demo mode banner" data-preview-device={previewDevice}>
    <div class="demo-banner-info">
      <span class="demo-badge">Demo</span>
      <span class="demo-copy">
        Demo mode &middot; Offline synthetic data &middot; Build <code>{displaySha}</code>
      </span>
    </div>

    <div class="demo-viewport-controls" role="group" aria-label="Viewport preview size">
      <span class="demo-viewport-label">Viewport</span>
      {#each VIEWPORT_OPTIONS as option (option.id)}
        <button
          type="button"
          class="demo-viewport-btn"
          class:active={previewDevice === option.id}
          aria-pressed={previewDevice === option.id}
          title={`${option.label} (${option.widthHint})`}
          onclick={() => selectDevice(option.id)}
        >
          {option.label}
          <span class="demo-width-hint">{option.widthHint}</span>
        </button>
      {/each}
    </div>
  </aside>
{/if}

<style>
  .demo-banner {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 0.5rem 0.875rem; padding: 0.375rem 0.75rem;
    background: var(--panel-solid, #ffffff); color: var(--text, #1c1c1f);
    border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.14));
    font-size: 0.8125rem; line-height: 1.35; z-index: 60;
  }
  .demo-banner-info { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  .demo-badge {
    display: inline-flex; align-items: center; padding: 0.125rem 0.45rem; border-radius: 999px;
    background: var(--accent, #1f6df0); color: var(--accent-text, #ffffff);
    font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em;
  }
  .demo-copy { color: var(--text, #1c1c1f); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .demo-copy code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.75rem; font-weight: 600; }
  .demo-viewport-controls { display: inline-flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
  .demo-viewport-label { margin-right: 0.25rem; color: var(--muted, #52525b); font-size: 0.75rem; font-weight: 600; }
  .demo-viewport-btn {
    display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.2rem 0.5rem;
    border: 1px solid var(--border, rgba(0, 0, 0, 0.16)); border-radius: 0.375rem;
    background: transparent; color: var(--text, #1c1c1f);
    font: inherit; font-size: 0.75rem; font-weight: 500; cursor: pointer;
  }
  .demo-viewport-btn.active {
    background: var(--accent, #1f6df0); border-color: var(--accent, #1f6df0); color: var(--accent-text, #ffffff);
  }
  .demo-viewport-btn:focus-visible { outline: 2px solid var(--accent, #1f6df0); outline-offset: 2px; }
  .demo-width-hint { opacity: 0.82; font-size: 0.6875rem; }
</style>
