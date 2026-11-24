<script lang="ts">
  import type { ServiceLogs, SystemService } from "../../../../../lib/contracts/os-api";

  let {
    service,
    logs,
    busy,
    error,
    onReload,
    onClose,
  }: {
    service: SystemService;
    logs: ServiceLogs | null;
    busy: boolean;
    error: string | null;
    onReload: () => void;
    onClose: () => void;
  } = $props();
</script>

<div class="log-drawer" role="region" aria-label="Service journal for {service.unit}">
  <div class="log-head">
    <span>Journal · {service.scope}:{service.unit}</span>
    <div class="log-tools">
      <span class="log-meta">
        {busy ? "Reading..." : logs?.available ? `${logs.entries.length} lines` : "unavailable"}
      </span>
      <button type="button" disabled={busy} onclick={onReload}>Reload</button>
      <button type="button" onclick={onClose}>Close</button>
    </div>
  </div>
  {#if busy}
    <p class="log-note">Reading bounded journal tail...</p>
  {:else if error}
    <p class="feedback error" role="alert">{error}</p>
  {:else if logs}
    {#if logs.available}
      <pre class="log-body">{logs.entries.join("\n") || "No journal entries."}</pre>
    {:else}
      <p class="log-note">{logs.diagnostic ?? "Journal unavailable for this unit."}</p>
    {/if}
  {:else}
    <p class="log-note">Journal reads require an Operator or Owner session.</p>
  {/if}
</div>

<style>
  .log-drawer {
    flex: 1 1 100%; min-width: 0; display: grid; gap: 0.5rem; margin-top: 0.25rem;
    padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem;
    background: color-mix(in srgb, var(--panel-solid) 70%, transparent);
  }
  .log-head {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    flex-wrap: wrap; font-size: 0.8125rem; color: var(--muted);
  }
  .log-tools { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .log-meta { font-variant-numeric: tabular-nums; }
  .log-body {
    margin: 0; max-height: 14rem; overflow: auto; padding: 0.5rem; border-radius: 0.375rem;
    background: var(--window-bg); color: var(--text); font-family: var(--font-mono);
    font-size: 0.75rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .log-note { margin: 0; font-size: 0.8125rem; color: var(--muted); }
</style>
