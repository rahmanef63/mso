<script lang="ts">
  import type { CatalogCard } from "./catalog-model.ts";

  let {
    card,
    onOpen,
  }: { card: CatalogCard; onOpen: (card: CatalogCard) => void } = $props();

  const initial = $derived(card.title.slice(0, 1).toUpperCase());
</script>

<li class="card" data-kind={card.kind} data-category={card.category}>
  <button type="button" class="card-hit" onclick={() => onOpen(card)} aria-label={`Open ${card.title} details`}>
    <span class="icon" aria-hidden="true">{initial}</span>
    <span class="card-body">
      <span class="card-head">
        <strong class="card-title">{card.title}</strong>
        <span class="pill" data-tone={card.kind === "managed" ? "ok" : "neutral"}>{card.kindLabel}</span>
      </span>
      <code class="card-id">{card.id}</code>
      <span class="card-summary">{card.summary}</span>
      <span class="card-foot">
        <span class="pill" data-tone="neutral">{card.category}</span>
        <span class="card-meta">{card.meta}</span>
      </span>
    </span>
  </button>
</li>

<style>
  .card { list-style: none; min-width: 0; }
  .card-hit {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: auto minmax(0, 1fr);
    width: 100%;
    text-align: left;
    padding: 0.875rem;
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    background: var(--panel-solid);
    color: var(--text);
    min-height: 0;
  }
  .card-hit:hover { border-color: var(--accent); }
  .icon {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.75rem;
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 700;
    font-size: 1.125rem;
  }
  .card-body { display: grid; gap: 0.25rem; min-width: 0; }
  .card-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .card-title { font-size: 0.9375rem; overflow-wrap: anywhere; }
  .card-id { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .card-summary { font-size: 0.8125rem; color: var(--muted); }
  .card-foot { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .card-meta { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
</style>
