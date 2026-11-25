<script module lang="ts">
  import type { Snippet } from "svelte";

  export type AppleSheetKind = "share" | "actions" | "form";

  export type AppleSheetAction = {
    readonly id: string;
    readonly label: string;
    /** Sprite id from AppleIcons.svelte, e.g. "g-gear". */
    readonly icon?: string;
    /** Renders in the destructive tint: system red, theme-adjusted for WCAG AA. */
    readonly danger?: boolean;
    /** Rows sharing a group value render under one separator block. */
    readonly group?: string;
    readonly onSelect: () => void;
  };

  export type AppleSheetShareApp = {
    readonly id: string;
    readonly label: string;
    readonly app: string;
    readonly onSelect: () => void;
  };

  export type AppleSheetProps = {
    readonly open: boolean;
    readonly kind: AppleSheetKind;
    readonly title: string;
    readonly isMobile?: boolean;
    readonly actions?: ReadonlyArray<AppleSheetAction>;
    readonly shareApps?: ReadonlyArray<AppleSheetShareApp>;
    readonly children?: Snippet;
    readonly onClose: () => void;
  };
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { resolveAppIcon } from "./app-icons.ts";

  let {
    open,
    kind,
    title,
    isMobile = false,
    actions = [],
    shareApps = [],
    children,
    onClose,
  }: AppleSheetProps = $props();

  let dialogEl = $state<HTMLDivElement | null>(null);
  let returnFocus: HTMLElement | null = null;

  const groups = $derived.by(() => {
    const out: { key: string; rows: AppleSheetAction[] }[] = [];
    for (const action of actions) {
      const key = action.group ?? "";
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(action);
      else out.push({ key, rows: [action] });
    }
    return out;
  });

  $effect(() => {
    if (!open) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => {
      dialogEl?.focus();
    });
    return () => {
      returnFocus?.focus?.();
      returnFocus = null;
    };
  });

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) onClose();
  }

  function run(action: AppleSheetAction) {
    action.onSelect();
    onClose();
  }

  function shareVisual(app: string) {
    return resolveAppIcon(app, "macos");
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div
    class="aos-sheet-backdrop"
    class:is-mobile={isMobile}
    role="presentation"
    onclick={handleBackdropClick}
  >
    <div
      bind:this={dialogEl}
      class="aos-sheet-stack"
      class:is-mobile={isMobile}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      data-sheet-kind={kind}
    >
      <div class="aos-sheet-card">
        {#if isMobile}
          <div class="aos-sheet-grabber-wrap" aria-hidden="true">
            <span class="aos-sheet-grabber"></span>
          </div>
        {/if}

        <header class="aos-sheet-head">
          <h2 class="aos-sheet-title">{title}</h2>
          {#if !isMobile}
            <button type="button" class="aos-sheet-close" aria-label="Close" onclick={onClose}>
              <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                <use href="#g-xmark" />
              </svg>
            </button>
          {/if}
        </header>

        {#if kind === "share" && shareApps.length > 0}
          <div class="aos-sheet-share-grid">
            {#each shareApps as entry (entry.id)}
              {@const visual = shareVisual(entry.app)}
              <button
                type="button"
                class="aos-sheet-share-item"
                onclick={() => {
                  entry.onSelect();
                  onClose();
                }}
              >
                <span class="aos-sheet-share-icon" style={`background: ${visual.gradient};`}>
                  {#if visual.image}
                    <img src={visual.image} alt="" loading="lazy" draggable="false" />
                  {:else}
                    <span class="aos-sheet-share-mono" aria-hidden="true">{visual.monogram}</span>
                  {/if}
                </span>
                <span class="aos-sheet-share-label">{entry.label}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if kind === "form" && children}
          <div class="aos-sheet-form">
            {@render children()}
          </div>
        {/if}

        {#if groups.length > 0}
          {#each groups as group, index (group.key + index)}
            <div class="aos-sheet-actions">
              {#each group.rows as action (action.id)}
                <button
                  type="button"
                  class="aos-sheet-action"
                  class:is-danger={action.danger}
                  onclick={() => run(action)}
                >
                  <span class="aos-sheet-action-label">{action.label}</span>
                  {#if action.icon}
                    <svg class="aos-sheet-action-ico" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                      <use href={`#${action.icon}`} />
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          {/each}
        {/if}

        {#if !isMobile}
          <footer class="aos-sheet-footer">
            <button type="button" class="aos-sheet-done" onclick={onClose}>Cancel</button>
          </footer>
        {/if}
      </div>

      {#if isMobile}
        <button type="button" class="aos-sheet-cancel-card" onclick={onClose}>Cancel</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .aos-sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 8600;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.36);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
    animation: fadeBg var(--durF) ease;
  }

  .aos-sheet-backdrop.is-mobile {
    align-items: flex-end;
    padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
  }

  .aos-sheet-stack {
    width: min(380px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    display: flex;
    flex-direction: column;
    outline: none;
    animation: ccIn var(--durF) cubic-bezier(0.2, 0.9, 0.3, 1);
  }

  .aos-sheet-stack.is-mobile {
    width: min(440px, 100%);
    max-height: calc(100dvh - 32px);
    gap: 8px;
    animation: sheetUp var(--dur) cubic-bezier(0.22, 1, 0.36, 1);
  }

  .aos-sheet-card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 22px;
    background: var(--glass-bg);
    color: var(--label);
    -webkit-backdrop-filter: blur(var(--blur)) saturate(180%);
    backdrop-filter: blur(var(--blur)) saturate(180%);
    border: 0.5px solid var(--glass-stroke);
    box-shadow: var(--shadow-pop);
  }

  .aos-sheet-stack.is-mobile .aos-sheet-card {
    border-radius: 14px;
  }

  .aos-sheet-grabber-wrap {
    display: flex;
    justify-content: center;
    padding: 8px 0 2px;
  }

  .aos-sheet-grabber {
    width: 36px;
    height: 5px;
    border-radius: 999px;
    background: var(--label3);
  }

  .aos-sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 16px 12px;
    border-bottom: 0.5px solid var(--sep);
  }

  .aos-sheet-stack.is-mobile .aos-sheet-head {
    justify-content: center;
    padding: 8px 16px 12px;
  }

  .aos-sheet-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--label);
  }

  .aos-sheet-close {
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--fill);
    color: var(--label2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .aos-sheet-close:hover {
    background: var(--fill2);
    color: var(--label);
  }

  .aos-sheet-share-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px 8px;
    padding: 16px;
  }

  .aos-sheet-share-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-height: 0;
    padding: 4px 2px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--label);
  }

  .aos-sheet-share-item:hover {
    background: var(--fill);
  }

  .aos-sheet-share-icon {
    width: 52px;
    height: 52px;
    border-radius: 23%;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.45);
  }

  .aos-sheet-share-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .aos-sheet-share-mono {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
  }

  .aos-sheet-share-label {
    font-size: 11px;
    font-weight: 500;
    line-height: 1.2;
    color: var(--label);
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .aos-sheet-form {
    padding: 14px 16px;
    overflow-y: auto;
  }

  .aos-sheet-actions {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-top: 0.5px solid var(--sep);
  }

  .aos-sheet-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 12px 16px;
    border: 0;
    border-bottom: 0.5px solid var(--sep);
    border-radius: 0;
    background: transparent;
    color: var(--label);
    font-size: 15px;
    font-weight: 400;
    text-align: left;
  }

  .aos-sheet-action:last-child {
    border-bottom: 0;
  }

  .aos-sheet-action:hover {
    background: var(--fill);
  }

  .aos-sheet-card {
    /* iOS destructive red at 3.4:1 on light glass, so light theme uses the darker system red. */
    --sheet-danger: #d70015;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .aos-sheet-card {
      --sheet-danger: #ff453a;
    }
  }

  :global(:root[data-theme="dark"]) .aos-sheet-card {
    --sheet-danger: #ff453a;
  }

  .aos-sheet-action.is-danger {
    color: var(--sheet-danger);
  }

  .aos-sheet-action-label {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .aos-sheet-action-ico {
    flex-shrink: 0;
    color: var(--label2);
  }

  .aos-sheet-action.is-danger .aos-sheet-action-ico {
    color: var(--sheet-danger);
  }

  .aos-sheet-footer {
    padding: 10px 14px 14px;
    border-top: 0.5px solid var(--sep);
    display: flex;
    justify-content: flex-end;
  }

  .aos-sheet-done {
    min-height: 32px;
    padding: 5px 14px;
    border-radius: 999px;
    border: 0.5px solid var(--sep);
    background: var(--fill);
    color: var(--label);
    font-size: 13px;
    font-weight: 500;
  }

  .aos-sheet-done:hover {
    background: var(--fill2);
  }

  .aos-sheet-cancel-card {
    width: 100%;
    min-height: 52px;
    padding: 12px 16px;
    border-radius: 14px;
    background: var(--glass-bg);
    color: var(--tint);
    -webkit-backdrop-filter: blur(var(--blur)) saturate(180%);
    backdrop-filter: blur(var(--blur)) saturate(180%);
    border: 0.5px solid var(--glass-stroke);
    box-shadow: var(--shadow-pop);
    font-size: 16px;
    font-weight: 600;
    text-align: center;
  }

  .aos-sheet-cancel-card:hover {
    filter: brightness(1.04);
  }

  :global(:root[data-reduce-glass="true"]) .aos-sheet-card,
  :global(:root[data-reduce-glass="true"]) .aos-sheet-cancel-card {
    background: var(--panel-solid);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  :global(:root[data-high-contrast="true"]) .aos-sheet-card,
  :global(:root[data-high-contrast="true"]) .aos-sheet-cancel-card {
    border-color: var(--label2);
  }

  :global(:root[data-reduced-motion="true"]) .aos-sheet-backdrop,
  :global(:root[data-reduced-motion="true"]) .aos-sheet-stack {
    animation: none;
  }
</style>
