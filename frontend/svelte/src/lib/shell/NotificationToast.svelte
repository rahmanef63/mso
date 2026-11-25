<script lang="ts">
  import type { NotificationItem } from "./notifications-store.ts";

  let {
    items,
    onDismiss,
  }: {
    items: readonly NotificationItem[];
    onDismiss: (id: string) => void;
  } = $props();

  function roleFor(tone: NotificationItem["tone"]): "alert" | "status" {
    return tone === "error" || tone === "warn" ? "alert" : "status";
  }
</script>

<div class="toast-region" role="region" aria-label="Notifications" aria-live="polite">
  {#each items as item (item.id)}
    <article
      class={`toast-pill tone-${item.tone}`}
      role={roleFor(item.tone)}
      data-toast-id={item.id}
      data-tone={item.tone}
    >
      <span class="toast-dot" aria-hidden="true"></span>
      <div class="toast-copy">
        <strong class="toast-title">{item.title}</strong>
        {#if item.detail}
          <p class="toast-detail">{item.detail}</p>
        {/if}
      </div>
      <button
        type="button"
        class="toast-dismiss"
        aria-label={`Dismiss ${item.title}`}
        onclick={() => onDismiss(item.id)}
      >
        Dismiss
      </button>
    </article>
  {/each}
</div>

<style>
  .toast-region {
    position: fixed;
    bottom: 72px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 55;
    display: grid;
    gap: 0.5rem;
    width: min(30rem, calc(100vw - 2rem));
    justify-items: center;
    pointer-events: none;
  }
  .toast-pill {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: fit-content;
    max-width: 100%;
    padding: 0.625rem 0.75rem 0.625rem 0.875rem;
    border-radius: 14px;
    background: var(--glass-bg);
    color: var(--label);
    border: 0.5px solid var(--glass-stroke);
    -webkit-backdrop-filter: blur(30px) saturate(180%);
    backdrop-filter: blur(30px) saturate(180%);
    box-shadow: var(--shadow-pop);
    animation: toastIn 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .toast-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    flex-shrink: 0;
    background: var(--tint);
  }
  .toast-pill.tone-ok .toast-dot { background: var(--ok); }
  .toast-pill.tone-warn .toast-dot { background: var(--warn); }
  .toast-pill.tone-error .toast-dot { background: #ff453a; }
  .toast-copy {
    display: grid;
    gap: 0.125rem;
    min-width: 0;
    flex: 1 1 auto;
  }
  .toast-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--label);
    overflow-wrap: anywhere;
  }
  .toast-detail {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--label2);
    overflow-wrap: anywhere;
  }
  .toast-dismiss {
    flex-shrink: 0;
    min-height: 1.75rem;
    padding: 0.125rem 0.5rem;
    border: 0;
    border-radius: 999px;
    background: var(--fill);
    color: var(--label2);
    font-size: 0.75rem;
    font-weight: 500;
  }
  .toast-dismiss:hover {
    background: var(--fill2);
    color: var(--label);
  }
  @media (max-width: 639px) {
    .toast-region { bottom: 110px; }
  }
  :global(:root[data-reduce-glass="true"]) .toast-pill {
    background: var(--panel-solid);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  :global(:root[data-high-contrast="true"]) .toast-pill {
    background: var(--panel-solid);
    border-color: var(--label2);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  :global(:root[data-reduced-motion="true"]) .toast-pill {
    animation: none;
  }
</style>
