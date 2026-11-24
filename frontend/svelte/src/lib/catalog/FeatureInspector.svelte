<script lang="ts">
  import type { ModularFeatureSummary } from "./catalog-api.ts";
  import { featureHeading, formatIntegrity, integrityTone } from "./catalog-model.ts";

  let {
    feature,
    onClose,
  }: { feature: ModularFeatureSummary | null; onClose: () => void } = $props();

  function onKeydown(event: KeyboardEvent) {
    if (feature && event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if feature}
  {@const digest = formatIntegrity(feature.integrity)}
  <div class="inspector-layer">
    <button type="button" class="inspector-backdrop" aria-label="Close feature details" tabindex="-1" onclick={onClose}></button>
    <div class="inspector" role="dialog" aria-modal="true" aria-labelledby="feature-detail-title">
      <header class="inspector-head">
        <h3 id="feature-detail-title">{featureHeading(feature)}</h3>
        <button type="button" onclick={onClose}>Close</button>
      </header>

      <dl class="inspector-facts">
        <div><dt>Package ID</dt><dd><code>{feature.id}</code></dd></div>
        <div><dt>Version</dt><dd>{feature.version}</dd></div>
        <div><dt>Minimum role</dt><dd>{feature.minRole ?? "owner"}</dd></div>
        <div><dt>Entry point</dt><dd><code>{feature.entry ?? "not published"}</code></dd></div>
        <div><dt>Installed at</dt><dd>{feature.updatedAt ?? "not published"}</dd></div>
        <div>
          <dt>Integrity</dt>
          <dd>
            {#if digest}
              <span class="pill" data-tone={integrityTone(feature.integrity)}>{digest}</span>
              <span class="digest-note">The host re-checks this digest before serving the entry file, so a tampered package stops loading instead of running.</span>
            {:else}
              <span class="pill" data-tone="warn">not published</span>
              <span class="digest-note">This snapshot carries no digest. The host still verifies the entry file before it serves it.</span>
            {/if}
          </dd>
        </div>
      </dl>

      {#if feature.description}
        <section class="inspector-block" aria-label="Package description">
          <h4>What it adds</h4>
          <p>{feature.description}</p>
        </section>
      {/if}

      <section class="inspector-block" aria-label="Update guidance">
        <h4>Updating</h4>
        <p>
          Modular features update independently of MSO core. Repack the package under ~/.mso/features with
          <code>bun run feature:pack</code>; the host picks the new manifest up on the next catalog read.
        </p>
      </section>
    </div>
  </div>
{/if}

<style>
  .inspector-layer { position: fixed; inset: 0; z-index: 40; display: grid; place-items: end stretch; }
  .inspector-backdrop {
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
  .inspector {
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
  .inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .inspector-facts { display: grid; gap: 0.5rem; margin: 0; }
  .inspector-facts div { display: grid; gap: 0.125rem; }
  .inspector-facts dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .inspector-facts dd { margin: 0; font-size: 0.875rem; color: var(--text); overflow-wrap: anywhere; }
  .digest-note { display: block; margin-top: 0.25rem; font-size: 0.75rem; color: var(--muted); }
  .inspector-block { display: grid; gap: 0.375rem; }
  .inspector-block h4 { margin: 0; font-size: 0.875rem; }
  .inspector-block p { margin: 0; font-size: 0.875rem; }
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
  @media (min-width: 640px) {
    .inspector-layer { place-items: center; padding: 1rem; }
    .inspector { border-radius: 0.875rem; }
  }
</style>
