<script lang="ts">
  import type { ModularFeatureSummary } from "./catalog-api.ts";
  import { featureHeading, formatIntegrity, integrityTone, type Tone } from "./catalog-model.ts";

  let {
    feature,
    onInspect,
  }: {
    feature: ModularFeatureSummary;
    onInspect: (feature: ModularFeatureSummary) => void;
  } = $props();

  let heading = $derived(featureHeading(feature));
  let assetUrl = $derived(feature.entry
    ? `/api/v1/features/${encodeURIComponent(feature.id)}/asset/${feature.entry.replace(/^\/+/, "")}`
    : null);
  let minRole = $derived(feature.minRole ?? "owner");
  let updated = $derived(feature.updatedAt ? feature.updatedAt.slice(0, 10) : null);

  function roleTone(role: string): Tone {
    if (role === "viewer") return "ok";
    if (role === "operator") return "warn";
    return "danger";
  }
</script>

<li class="feat">
  <div class="feat-head">
    <strong class="feat-title">{heading}</strong>
    <span class="pill" data-tone="neutral">v{feature.version}</span>
    <span class="pill" data-tone={roleTone(minRole)}>min {minRole}</span>
    {#if formatIntegrity(feature.integrity)}
      <span class="pill" data-tone={integrityTone(feature.integrity)} title={feature.integrity}>{formatIntegrity(feature.integrity)}</span>
    {:else}
      <span class="pill" data-tone="warn">no digest</span>
    {/if}
  </div>
  <code class="feat-id">{feature.id}</code>
  {#if feature.description}<p class="feat-desc">{feature.description}</p>{/if}
  <div class="feat-foot">
    {#if updated}<span class="feat-meta">Updated {updated}</span>{/if}
    {#if assetUrl}<a class="feat-link" href={assetUrl} target="_blank" rel="noopener noreferrer">Open package</a>{/if}
    <button type="button" onclick={() => onInspect(feature)}>Inspect</button>
  </div>
</li>

<style>
  .feat {
    list-style: none;
    display: grid;
    gap: 0.375rem;
    padding: 0.875rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--panel-solid);
    min-width: 0;
  }
  .feat-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .feat-title { font-size: 0.9375rem; overflow-wrap: anywhere; }
  .feat-id { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .feat-desc { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .feat-foot { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.25rem; }
  .feat-meta { font-size: 0.75rem; color: var(--muted); }
  .feat-link { font-size: 0.8125rem; color: var(--text); text-decoration: underline; }
  .pill {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
