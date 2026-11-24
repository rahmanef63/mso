<script lang="ts">
  import type { MobileNavSpec } from "./shell-design.ts";

  let {
    variant,
    appTitle,
    mobileNav = null,
    onBackHome,
    onOpenAi,
    onCloseApp,
  }: {
    variant: "ios" | "android";
    appTitle: string;
    mobileNav?: MobileNavSpec | null;
    onBackHome: () => void;
    onOpenAi: () => void;
    onCloseApp?: () => void;
  } = $props();

  let displayTitle = $derived(mobileNav?.title ?? appTitle);
  let backLabel = $derived(mobileNav?.backLabel ?? "Home");

  function handleBack() {
    if (mobileNav?.onBack) {
      mobileNav.onBack();
      return;
    }
    onBackHome();
  }
</script>

<header
  class="mobile-app-bar"
  class:is-ios={variant === "ios"}
  class:is-android={variant === "android"}
  data-mobile-nav={variant}
>
  <button
    type="button"
    class="mab-btn mab-back"
    aria-label={`Back to ${backLabel}`}
    onclick={handleBack}
  >
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {#if variant === "ios"}
        <path d="M12.5 4.5 7 10l5.5 5.5" />
      {:else}
        <path d="M15 10H5M10 5l-5 5 5 5" />
      {/if}
    </svg>
    <span class="mab-back-text">{backLabel}</span>
  </button>

  <h1 class="mab-title" title={displayTitle}>{displayTitle}</h1>

  <div class="mab-actions">
    <button
      type="button"
      class="mab-btn mab-ai"
      aria-label="Open Alfa Assistant"
      title="Alfa Assistant"
      onclick={onOpenAi}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6L10 3Z" />
      </svg>
      <span class="sr-only">Alfa AI</span>
    </button>
    {#if onCloseApp}
      <button
        type="button"
        class="mab-btn mab-close"
        aria-label={`Close ${appTitle}`}
        title={`Close ${appTitle}`}
        onclick={onCloseApp}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
          <path d="M5 5l10 10M15 5 5 15" />
        </svg>
      </button>
    {/if}
  </div>
</header>

<style>
  .mobile-app-bar {
    position: sticky;
    top: 0;
    z-index: 25;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);
    align-items: center;
    gap: 0.375rem;
    min-height: 3rem;
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--window-head);
    color: var(--text);
    backdrop-filter: blur(var(--blur)) saturate(180%);
    -webkit-backdrop-filter: blur(var(--blur)) saturate(180%);
    flex-shrink: 0;
  }

  .mobile-app-bar.is-ios {
    min-height: 3rem;
    padding-inline: 0.375rem;
  }

  .mobile-app-bar.is-android {
    min-height: 3.5rem;
    padding-inline: 0.5rem;
    background: var(--panel-solid);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .mab-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: 0.25rem 0.5rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text);
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .mobile-app-bar.is-android .mab-btn {
    min-width: 3rem;
    min-height: 3rem;
  }

  .mab-btn svg {
    width: 1.2rem;
    height: 1.2rem;
    flex-shrink: 0;
  }

  .mab-back {
    justify-self: start;
    max-width: 100%;
    overflow: hidden;
  }

  .mobile-app-bar.is-ios .mab-back {
    color: var(--accent);
    font-weight: 500;
  }

  .mab-back-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mab-title {
    margin: 0;
    grid-column: 2;
    justify-self: center;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mab-actions {
    grid-column: 3;
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
  }

  .mab-ai {
    color: var(--accent);
  }

  .mab-btn:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  /* iOS Modern floating translucent navigation pill treatment */
  :global([data-ios-style="modern"]) .mobile-app-bar.is-ios {
    margin: 0.375rem 0.625rem 0.25rem;
    border: 1px solid color-mix(in srgb, var(--glass-border) 75%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--panel) 78%, transparent);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16), inset 0 0.5px 0 rgba(255, 255, 255, 0.45);
  }

  :global([data-reduce-glass="true"]) .mobile-app-bar {
    background: var(--panel-solid);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
</style>
