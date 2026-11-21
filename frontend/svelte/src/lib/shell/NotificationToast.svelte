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
      class={`toast-card tone-${item.tone}`}
      role={roleFor(item.tone)}
      data-toast-id={item.id}
      data-tone={item.tone}
    >
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
    position: fixed; right: 1rem; bottom: 1rem; z-index: 55;
    width: min(24rem, calc(100vw - 2rem));
    display: grid; gap: .5rem; pointer-events: none;
  }
  .toast-card {
    pointer-events: auto;
    display: flex; align-items: flex-start; justify-content: space-between; gap: .75rem;
    padding: .75rem 1rem; border-radius: .625rem;
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.2);
  }
  .toast-card.tone-info { border-left: 4px solid var(--accent); }
  .toast-card.tone-ok {
    background: var(--ok-bg); color: var(--ok); border-color: var(--ok); border-left-width: 4px;
  }
  .toast-card.tone-warn {
    background: var(--warn-bg); color: var(--warn); border-color: var(--warn); border-left-width: 4px;
  }
  .toast-card.tone-error {
    background: var(--danger-bg); color: var(--danger); border-color: var(--danger); border-left-width: 4px;
  }
  .toast-copy { display: grid; gap: .25rem; min-width: 0; }
  .toast-title { font-size: .9375rem; color: inherit; overflow-wrap: anywhere; }
  .toast-detail { margin: 0; font-size: .875rem; color: inherit; overflow-wrap: anywhere; }
  .toast-card.tone-info .toast-detail { color: var(--muted); }
  .toast-dismiss {
    flex-shrink: 0; min-height: 2.25rem; padding: .25rem .625rem; font-size: .8125rem;
  }
  @media (max-width: 30rem) {
    .toast-region { left: 1rem; right: 1rem; width: auto; }
  }
</style>
