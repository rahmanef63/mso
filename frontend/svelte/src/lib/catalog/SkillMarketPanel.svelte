<script lang="ts">
  import {
    createSkillMarketController,
    matchesMarketRow,
    type SkillMarketRow,
    type SkillMarketState,
  } from "./catalog-market.ts";
  import { marketStateTone, type Tone } from "./catalog-model.ts";

  let { isOwner }: { isOwner: boolean } = $props();

  let marketState = $state<SkillMarketState>({ kind: "loading" });
  let query = $state("");
  let inspector = $state<SkillMarketRow | null>(null);
  let controller: ReturnType<typeof createSkillMarketController> | undefined;

  let rows = $derived(marketState.kind === "ready" ? marketState.market.skills : []);
  let visible = $derived.by<SkillMarketRow[]>(() => rows.filter((row) => matchesMarketRow(row, query)));
  let installedCount = $derived.by<number>(() => rows.filter((row) => row.state === "installed").length);

  export function refresh() {
    void controller?.refresh();
  }

  function securityTone(security: string): Tone {
    if (security === "clean") return "ok";
    if (security.startsWith("clean-with") || security === "mso-safe-wrapper") return "warn";
    return "neutral";
  }

  function onKeydown(event: KeyboardEvent) {
    if (inspector && event.key === "Escape") {
      event.preventDefault();
      inspector = null;
    }
  }

  $effect(() => {
    if (!isOwner) return;
    const next = createSkillMarketController((s) => { marketState = s; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<section class="market" aria-labelledby="skill-market-title" data-skill-market-state={marketState.kind}>
  <header class="market-head">
    <div class="market-title-group">
      <h3 id="skill-market-title">Skill Market</h3>
      {#if marketState.kind === "ready"}
        <span class="pill" data-tone="neutral">{installedCount} of {rows.length} installed</span>
      {/if}
    </div>
    <button type="button" disabled={marketState.kind === "loading"} onclick={refresh} aria-label="Refresh skill market">
      {marketState.kind === "loading" ? "Loading..." : "Refresh"}
    </button>
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to browse the reviewed skill market. Sign in from an Owner device to inspect curated skills.
    </p>
  {:else}
    <p class="market-intro">
      Reviewed skills install into MSO's local skill directory with a verified checksum. Installing stays a
      terminal action, because a store button that rewrites ~/.mso/skills would bypass the review that makes the
      checksum meaningful.
    </p>

    <div class="field market-search">
      <label for="skill-market-filter">Search market skills</label>
      <input id="skill-market-filter" type="search" bind:value={query} placeholder="Name, ID, description, source, or state" />
    </div>

    <div role="status" aria-live="polite">
      {#if marketState.kind === "loading"}
        <p>Loading skill market...</p>
      {:else if marketState.kind === "error"}
        <p class="feedback error" role="alert">{marketState.message}</p>
      {:else if rows.length === 0}
        <p>The reviewed skill market published no skills for this installation.</p>
      {:else if visible.length === 0}
        <p>No market skills match this search.</p>
      {:else}
        {#if marketState.market.root}
          <p class="market-root">Install directory: <code>{marketState.market.root}</code></p>
        {/if}
        <ul class="market-grid" aria-label="Reviewed skill market">
          {#each visible as row (row.id)}
            <li class="market-card">
              <div class="market-card-head">
                <strong>{row.title}</strong>
                <span class="pill" data-tone={marketStateTone(row.state)}>{row.state}</span>
              </div>
              <code class="market-id">{row.id}</code>
              <p class="market-desc">{row.description}</p>
              <div class="market-meta">
                <span class="pill" data-tone={securityTone(row.security)}>{row.security}</span>
                <span class="pill" data-tone="neutral">v{row.version}</span>
                <span class="market-source">{row.source}</span>
              </div>
              <button type="button" onclick={() => { inspector = row; }}>Inspect</button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if inspector}
      <div class="market-layer">
        <button type="button" class="market-backdrop" aria-label="Close skill details" tabindex="-1" onclick={() => { inspector = null; }}></button>
        <div class="market-dialog" role="dialog" aria-modal="true" aria-labelledby="market-detail-title">
          <header class="market-card-head">
            <h4 id="market-detail-title">{inspector.title}</h4>
            <button type="button" onclick={() => { inspector = null; }}>Close</button>
          </header>
          <dl class="market-facts">
            <div><dt>Skill ID</dt><dd><code>{inspector.id}</code></dd></div>
            <div><dt>Version</dt><dd>{inspector.version}</dd></div>
            <div><dt>Source</dt><dd>{inspector.source}</dd></div>
            <div><dt>Review</dt><dd>{inspector.security}</dd></div>
            <div><dt>State</dt><dd>{inspector.state}</dd></div>
          </dl>
          <p class="market-desc">{inspector.description}</p>
          <p class="market-hint">
            {#if inspector.canInstall}
              Ready to install or update. Run <code>mso skills install {inspector.id}</code> in the terminal.
            {:else if inspector.canRemove}
              Installed and unchanged. Remove it with <code>mso skills remove {inspector.id}</code>.
            {:else}
              Local files or unmanaged changes block store actions here. Review the skill directory before changing it.
            {/if}
          </p>
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .market { min-width: 0; }
  .market-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .market-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .market-intro { margin: 0.625rem 0; font-size: 0.875rem; }
  .market-search { margin-bottom: 0.75rem; }
  .market-search input { width: 100%; min-width: 0; }
  label { font-size: 0.8125rem; font-weight: 600; color: var(--text); }
  .market-root { margin: 0 0 0.5rem; font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .market-grid { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
  .market-card {
    display: grid;
    gap: 0.375rem;
    justify-items: start;
    padding: 0.875rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--panel-solid);
    min-width: 0;
  }
  .market-card-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; width: 100%; }
  .market-id { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .market-desc { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .market-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .market-source { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .market-facts { display: grid; gap: 0.375rem; margin: 0; }
  .market-facts dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .market-facts dd { margin: 0; font-size: 0.875rem; color: var(--text); overflow-wrap: anywhere; }
  .market-hint { margin: 0; font-size: 0.8125rem; }
  .market-layer { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 1rem; }
  .market-backdrop {
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
  .market-dialog {
    position: relative;
    display: grid;
    gap: 0.75rem;
    align-content: start;
    width: min(30rem, 100%);
    max-height: 86vh;
    overflow-y: auto;
    padding: 1rem 1.125rem;
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    background: var(--window-bg);
    -webkit-backdrop-filter: blur(var(--blur));
    backdrop-filter: blur(var(--blur));
    box-shadow: var(--shadow-pop);
  }
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
  @media (min-width: 720px) {
    .market-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
