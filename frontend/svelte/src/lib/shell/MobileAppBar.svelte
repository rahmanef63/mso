<script lang="ts">
  import type { MobileNavSpec } from "./shell-design.ts";

  let {
    variant,
    appTitle,
    mobileNav = null,
    isPad = false,
    padFloating = false,
    scrolled = false,
    onBackHome,
    onOpenAi,
    onCloseApp,
  }: {
    variant: "ios" | "android";
    appTitle: string;
    mobileNav?: MobileNavSpec | null;
    isPad?: boolean;
    padFloating?: boolean;
    scrolled?: boolean;
    onBackHome: () => void;
    onOpenAi: () => void;
    onCloseApp?: () => void;
  } = $props();

  let displayTitle = $derived(mobileNav?.title ?? appTitle);
  let backLabel = $derived(mobileNav?.backLabel ?? "Home");
  let collapsed = $derived(variant === "ios" && scrolled);

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
  class:is-pad={variant === "ios" && isPad}
  class:is-pad-floating={variant === "ios" && isPad && padFloating}
  class:is-android={variant === "android"}
  class:is-scrolled={collapsed}
  data-mobile-nav={variant}
>
  <button
    type="button"
    class="mab-btn mab-back"
    aria-label={`Back to ${backLabel}`}
    onclick={handleBack}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={variant === "ios" ? "2.2" : "2"}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {#if variant === "ios"}
        <path d="M15 5l-7 7 7 7" />
      {:else}
        <path d="M19 12H5M12 5l-7 7 7 7" />
      {/if}
    </svg>
    <span class="mab-back-text">{backLabel}</span>
  </button>

  <h1 class="mab-title" class:is-large={variant === "ios" && !collapsed && !isPad} title={displayTitle}>{displayTitle}</h1>

  <div class="mab-actions">
    <button
      type="button"
      class="mab-btn mab-ai"
      aria-label="Open Alfa Assistant"
      title="Alfa Assistant"
      onclick={onOpenAi}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
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
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          aria-hidden="true"
        >
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
    z-index: 39;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    min-height: 46px;
    padding: 0 8px;
    border-bottom: 0.5px solid var(--sep, var(--border));
    background: var(--glass-bg, var(--window-head));
    color: var(--label, var(--text));
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    flex-shrink: 0;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    transition: background-color 200ms ease, border-color 200ms ease;
  }

  .mobile-app-bar.is-ios {
    height: 46px;
    min-height: 46px;
    padding: 0 8px;
    background: transparent;
    border-bottom-color: transparent;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .mobile-app-bar.is-ios.is-scrolled {
    background: var(--glass-bg, var(--window-head));
    border-bottom-color: var(--sep, var(--border));
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
  }

  .mobile-app-bar.is-ios.is-pad {
    height: 48px;
    min-height: 48px;
    margin: 6px 16px 4px;
    padding: 0 14px;
    border-radius: 15px;
    border: 0.5px solid var(--glass-stroke, var(--border));
    background: var(--glass-bg, var(--window-head));
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    box-shadow:
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.45)),
      0 6px 20px var(--glass-shadow, rgba(0, 0, 0, 0.14));
  }

  .mobile-app-bar.is-ios.is-pad-floating {
    position: absolute;
    top: 34px;
    left: 16px;
    right: 16px;
    z-index: 41;
    margin: 0;
  }

  .mobile-app-bar.is-android {
    min-height: 3.5rem;
    padding-inline: 0.5rem;
    background: var(--panel-solid);
    border-bottom: 1px solid var(--border);
    color: var(--text);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .mab-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 44px;
    min-height: 44px;
    padding: 4px 6px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--label, var(--text));
    font-size: 16px;
    font-weight: 400;
    line-height: 1;
    transition: background-color 140ms ease, opacity 140ms ease;
  }

  .mab-btn:focus-visible {
    outline: 2px solid var(--tint, var(--accent));
    outline-offset: 2px;
  }

  .mobile-app-bar.is-android .mab-btn {
    gap: 0.25rem;
    min-width: 3rem;
    min-height: 3rem;
    padding: 0.25rem 0.5rem;
    color: var(--text);
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .mab-btn svg {
    width: 19px;
    height: 19px;
    flex-shrink: 0;
  }

  .mab-back {
    justify-self: start;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
  }

  .mobile-app-bar.is-ios .mab-back {
    color: var(--tint, var(--accent));
    font-size: 16px;
    font-weight: 400;
    padding-left: 2px;
    padding-right: 8px;
  }

  .mobile-app-bar.is-ios .mab-back svg {
    width: 20px;
    height: 20px;
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
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--label, var(--text));
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-app-bar.is-ios:not(.is-scrolled):not(.is-pad) {
    height: auto;
    min-height: 60px;
    align-items: center;
    padding-bottom: 6px;
    row-gap: 0;
  }

  .mobile-app-bar.is-ios:not(.is-scrolled):not(.is-pad) .mab-back {
    grid-row: 1;
  }

  .mobile-app-bar.is-ios:not(.is-scrolled):not(.is-pad) .mab-actions {
    grid-row: 1;
  }

  .mab-title.is-large {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-self: start;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.026em;
    padding-left: 2px;
  }

  .mobile-app-bar.is-ios.is-scrolled .mab-title {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }

  .mobile-app-bar.is-ios.is-pad .mab-title {
    font-size: 17px;
  }

  .mab-actions {
    grid-column: 3;
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .mobile-app-bar.is-ios .mab-ai,
  .mobile-app-bar.is-ios .mab-close {
    color: var(--tint, var(--accent));
  }

  .mobile-app-bar.is-android .mab-ai {
    color: var(--accent);
  }

  .mab-btn:hover {
    background: color-mix(in srgb, var(--label, var(--text)) 10%, transparent);
  }

  .mab-btn:active {
    opacity: 0.65;
  }

  /* iOS Modern Liquid Glass translucent floating nav bar treatment */
  :global([data-ios-style="modern"]) .mobile-app-bar.is-ios:not(.is-pad) {
    margin: 4px 10px 4px;
    border: 0.5px solid var(--glass-stroke, color-mix(in srgb, var(--glass-border) 75%, transparent));
    border-radius: 999px;
    background: var(--glass-bg, color-mix(in srgb, var(--panel) 78%, transparent));
    box-shadow:
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.48)),
      0 6px 20px var(--glass-shadow, rgba(0, 0, 0, 0.14));
  }

  :global(:root[data-reduce-glass="true"]) .mobile-app-bar {
    background: var(--panel-solid);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  :global(:root[data-high-contrast="true"]) .mobile-app-bar {
    background: var(--panel-solid);
    border-bottom: 1.5px solid var(--border);
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  :global(:root[data-reduced-motion="true"]) .mobile-app-bar,
  :global(:root[data-reduced-motion="true"]) .mab-btn {
    transition: none;
  }
</style>
