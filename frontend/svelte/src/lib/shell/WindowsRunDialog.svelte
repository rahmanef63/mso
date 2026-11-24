<script lang="ts">
  import { tick } from "svelte";
  import type { DockAppDef } from "./shell-registry.ts";

  let {
    open,
    dockApps,
    onOpenApp,
    onClose,
  }: {
    open: boolean;
    dockApps: readonly DockAppDef[];
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
    onClose: () => void;
  } = $props();

  let inputValue = $state("");
  let errorText = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!open) return;
    inputValue = "";
    errorText = null;
    void tick().then(() => {
      inputEl?.focus();
    });
  });

  function resolveApp(raw: string): DockAppDef | undefined {
    const q = raw.trim().toLowerCase();
    if (!q) return undefined;
    return (
      dockApps.find((item) => item.app.toLowerCase() === q) ??
      dockApps.find((item) => item.title.toLowerCase() === q) ??
      dockApps.find((item) => item.title.toLowerCase().startsWith(q)) ??
      dockApps.find((item) => item.label.toLowerCase().startsWith(q)) ??
      dockApps.find(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.app.toLowerCase().includes(q) ||
          item.label.toLowerCase().includes(q),
      )
    );
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("/")) {
      onOpenApp("files", "Files", trimmed, true);
      onClose();
      return;
    }

    const match = resolveApp(trimmed);
    if (!match) {
      errorText = `Cannot find '${trimmed}'. Check the app name or path and try again.`;
      return;
    }

    onOpenApp(match.app, match.title, match.payload, match.multi);
    onClose();
  }

  function handleBrowse() {
    onOpenApp("files", "Files", "~", true);
    onClose();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="wrun-layer">
    <button
      type="button"
      class="wrun-backdrop"
      aria-label="Close Run dialog"
      tabindex="-1"
      onclick={onClose}
    ></button>

    <div
      class="wrun-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="win-run-title"
    >
      <form class="wrun-form" onsubmit={handleSubmit}>
        <div class="wrun-header">
          <span class="wrun-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 7l5 5-5 5M12 17h7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <div>
            <h2 id="win-run-title">Run</h2>
            <p class="wrun-desc">
              Type the name of an app (such as files, terminal, settings, workflows) or a path (such as ~/projects) and MSO will open it for you.
            </p>
          </div>
        </div>

        <div class="wrun-field">
          <label for="win-run-input">Open:</label>
          <input
            id="win-run-input"
            bind:this={inputEl}
            type="text"
            list="win-run-suggestions"
            bind:value={inputValue}
            oninput={() => {
              errorText = null;
            }}
            placeholder="files, terminal, ~/projects"
            autocomplete="off"
            spellcheck={false}
          />
          <datalist id="win-run-suggestions">
            {#each dockApps as item (item.app)}
              <option value={item.app}>{item.title}</option>
            {/each}
          </datalist>
        </div>

        {#if errorText}
          <p class="wrun-error" role="alert">{errorText}</p>
        {/if}

        <div class="wrun-actions">
          <button type="submit" class="primary wrun-btn">OK</button>
          <button type="button" class="wrun-btn" onclick={onClose}>Cancel</button>
          <button type="button" class="wrun-btn" onclick={handleBrowse}>Browse...</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .wrun-layer {
    position: fixed;
    inset: 0;
    z-index: 8500;
    pointer-events: none;
  }

  .wrun-backdrop {
    position: fixed;
    inset: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: rgba(0, 0, 0, 0.24);
    pointer-events: auto;
    cursor: default;
  }

  .wrun-dialog {
    pointer-events: auto;
    position: fixed;
    left: 0.75rem;
    bottom: 3.75rem;
    width: min(25.5rem, calc(100vw - 1.5rem));
    padding: 1rem 1.125rem;
    border-radius: 0.625rem;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: 0 22px 56px rgba(0, 0, 0, 0.34);
  }

  .wrun-form {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .wrun-header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .wrun-icon {
    width: 32px;
    height: 32px;
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .wrun-icon svg {
    width: 19px;
    height: 19px;
  }

  .wrun-header h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
  }

  .wrun-desc {
    margin: 0.25rem 0 0;
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--muted);
  }

  .wrun-field {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.625rem;
  }

  .wrun-field label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text);
  }

  .wrun-field input {
    min-height: 34px;
    padding: 0.35rem 0.625rem;
    font-size: 0.875rem;
    width: 100%;
  }

  .wrun-error {
    margin: 0;
    padding: 0.5rem 0.65rem;
    border-radius: 0.45rem;
    font-size: 0.78rem;
    color: var(--danger);
    background: var(--danger-bg);
    border: 1px solid var(--danger);
  }

  .wrun-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding-top: 0.25rem;
  }

  .wrun-btn {
    min-height: 32px;
    min-width: 4.75rem;
    padding: 0.3rem 0.85rem;
    font-size: 0.8125rem;
  }
</style>
