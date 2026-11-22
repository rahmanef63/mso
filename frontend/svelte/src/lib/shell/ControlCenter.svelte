<script lang="ts">
  import { tick } from "svelte";
  import {
    CHROME_PROFILES,
    isChromeChoice,
    type ChromeChoice,
    type ChromeProfile,
  } from "./chrome-profile.ts";

  type ThemeChoice = "system" | "light" | "dark";

  let {
    open,
    theme,
    chromeChoice,
    resolvedChrome,
    role,
    openWindowCount,
    onThemeChange,
    onChromeChange,
    onLock,
    onOpenForceQuit,
    onClose,
  }: {
    open: boolean;
    theme: string;
    chromeChoice: ChromeChoice;
    resolvedChrome: ChromeProfile;
    role: string | null;
    openWindowCount: number;
    onThemeChange: (t: ThemeChoice) => void;
    onChromeChange: (c: ChromeChoice) => void;
    onLock: () => void;
    onOpenForceQuit: () => void;
    onClose: () => void;
  } = $props();

  let closeBtn = $state<HTMLButtonElement | null>(null);
  let normalizedTheme = $derived<ThemeChoice>(
    theme === "light" || theme === "dark" ? theme : "system",
  );

  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      closeBtn?.focus();
    });
  });

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function handleThemeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "system" || value === "light" || value === "dark") {
      onThemeChange(value);
    }
  }

  function handleChromeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (isChromeChoice(value)) {
      onChromeChange(value);
    }
  }

  function triggerLock() {
    onClose();
    onLock();
  }

  function triggerForceQuit() {
    onClose();
    onOpenForceQuit();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="cc-layer">
    <button
      type="button"
      class="cc-backdrop"
      aria-label="Close control center"
      tabindex="-1"
      onclick={onClose}
    ></button>

    <div
      class="cc-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="control-center-title"
    >
      <header class="cc-header">
        <h2 id="control-center-title">Control Center</h2>
        <button type="button" bind:this={closeBtn} class="cc-close" onclick={onClose}>
          Close
        </button>
      </header>

      <div class="cc-body">
        <dl class="cc-summary" aria-label="Workspace summary">
          <div class="metric">
            <dt>Session role</dt>
            <dd>{role ?? "Signed out"}</dd>
          </div>
          <div class="metric">
            <dt>Open windows</dt>
            <dd>{openWindowCount}</dd>
          </div>
          <div class="metric">
            <dt>Active chrome</dt>
            <dd>{resolvedChrome}</dd>
          </div>
        </dl>

        <div class="cc-controls">
          <div class="field">
            <label for="cc-theme-select">Theme</label>
            <select id="cc-theme-select" value={normalizedTheme} onchange={handleThemeSelect}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div class="field">
            <label for="cc-chrome-select">Shell chrome</label>
            <select id="cc-chrome-select" value={chromeChoice} onchange={handleChromeSelect}>
              <option value="auto">Auto ({resolvedChrome})</option>
              {#each CHROME_PROFILES as profile (profile.id)}
                <option value={profile.id}>{profile.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="cc-actions">
          <button type="button" onclick={triggerLock}>Lock screen</button>
          <button type="button" class="danger" onclick={triggerForceQuit}>
            Force quit windows...
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .cc-layer {
    position: fixed; inset: 0; z-index: 60;
    display: grid; place-items: center; padding: 1rem;
  }
  .cc-backdrop {
    position: fixed; inset: 0; min-height: 0; padding: 0; border: 0; border-radius: 0;
    background: rgba(0, 0, 0, 0.45); cursor: default;
  }
  .cc-dialog {
    position: relative; z-index: 1; width: min(30rem, 100%); max-height: 85vh;
    display: grid; grid-template-rows: auto minmax(0, 1fr);
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 0.75rem; overflow: hidden;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  }
  .cc-header {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    padding: 0.75rem 1rem; background: var(--surface); border-bottom: 1px solid var(--border);
  }
  .cc-header h2 { margin: 0; font-size: 1.0625rem; }
  .cc-close { min-height: var(--ui-control-height); padding: 0.5rem 0.875rem; }
  .cc-body { padding: 1rem; overflow-y: auto; display: grid; gap: 1rem; }
  .cc-summary {
    margin: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(7.5rem, 100%), 1fr));
    gap: 0.625rem;
  }
  .cc-summary .metric { padding: 0.625rem 0.75rem; background: var(--surface); }
  .cc-summary dd { font-size: 0.9375rem; }
  .cc-controls { display: grid; gap: 0.75rem; }
  .cc-actions {
    display: flex; flex-wrap: wrap; gap: 0.625rem; justify-content: flex-end;
    padding-top: 0.75rem; border-top: 1px solid var(--border);
  }
</style>
