<script lang="ts">
  import { tick } from "svelte";
  import type { CatalogCard } from "./catalog-model.ts";

  let {
    card,
    onClose,
    onLaunch,
  }: {
    card: CatalogCard | null;
    onClose: () => void;
    onLaunch: (url: string) => void;
  } = $props();

  let closeBtn = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (!card) return;
    void tick().then(() => closeBtn?.focus());
  });

  function onKeydown(event: KeyboardEvent) {
    if (!card) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if card}
  <div class="drawer-layer">
    <button type="button" class="drawer-backdrop" aria-label="Close app details" tabindex="-1" onclick={onClose}></button>
    <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title">
      <header class="drawer-head">
        <div class="drawer-title-group">
          <h3 id="catalog-detail-title">{card.title}</h3>
          <span class="pill" data-tone={card.kind === "managed" ? "ok" : "neutral"}>{card.kindLabel}</span>
        </div>
        <button type="button" bind:this={closeBtn} class="drawer-close" onclick={onClose}>Close</button>
      </header>

      <dl class="drawer-facts">
        <div><dt>Catalog ID</dt><dd><code>{card.id}</code></dd></div>
        <div><dt>Category</dt><dd>{card.category}</dd></div>
        <div><dt>Source</dt><dd>{card.meta}</dd></div>
        <div><dt>Availability</dt><dd>{card.kind === "managed" ? "This host provisions it" : "Published by an external provider"}</dd></div>
      </dl>

      <p class="drawer-summary">{card.summary}</p>

      {#if card.kind === "managed"}
        <section class="drawer-block" aria-label="Install guidance">
          <h4>Install and control</h4>
          <p>
            Managed apps install, start and restart from the Managed Apps surface, where this host proves the
            adapter, service state and health. This catalog only advertises the entry, so no install button here can
            run a command.
          </p>
        </section>
      {:else}
        <section class="drawer-block" aria-label="Connection status">
          <h4>Connection</h4>
          {#if card.launchUrl}
            <p>The provider published a launch address for this entry. Open it to continue in that application.</p>
            <button type="button" class="primary" onclick={() => onLaunch(card.launchUrl ?? "")}>Open {card.title}</button>
            <p class="drawer-url">{card.launchUrl}</p>
          {:else}
            <p>
              No launch address passed validation for this entry. Connected apps without a safe http or https address
              stay visible for reference and cannot be opened from MSO.
            </p>
          {/if}
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .drawer-layer { position: fixed; inset: 0; z-index: 40; display: grid; place-items: end stretch; }
  .drawer-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: rgba(12, 14, 20, 0.48);
    cursor: default;
  }
  .drawer {
    position: relative;
    display: grid;
    gap: 0.875rem;
    align-content: start;
    width: min(32rem, 100%);
    max-height: 88vh;
    overflow-y: auto;
    margin: 0 auto;
    padding: 1rem 1.125rem calc(1.25rem + env(safe-area-inset-bottom));
    border: 1px solid var(--border);
    border-radius: 0.875rem 0.875rem 0 0;
    background: var(--window-bg);
    -webkit-backdrop-filter: blur(var(--blur));
    backdrop-filter: blur(var(--blur));
    box-shadow: var(--shadow-pop);
  }
  .drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .drawer-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .drawer-close { min-height: var(--ui-control-height); }
  .drawer-facts { display: grid; gap: 0.5rem; margin: 0; }
  .drawer-facts div { display: grid; gap: 0.125rem; }
  .drawer-facts dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .drawer-facts dd { margin: 0; font-size: 0.875rem; color: var(--text); overflow-wrap: anywhere; }
  .drawer-summary { margin: 0; font-size: 0.9375rem; }
  .drawer-block { display: grid; gap: 0.5rem; justify-items: start; }
  .drawer-block h4 { margin: 0; font-size: 0.875rem; }
  .drawer-block p { margin: 0; font-size: 0.875rem; }
  .drawer-url { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  @media (min-width: 640px) {
    .drawer-layer { place-items: center; padding: 1rem; }
    .drawer { border-radius: 0.875rem; }
  }
</style>
