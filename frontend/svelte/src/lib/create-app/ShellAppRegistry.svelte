<script lang="ts">
  import type { ShellAppSnapshot } from "./create-app-api.ts";

  let {
    snapshot, busy, confirmRemoveId, notice, error,
    onRequestRemove, onCancelRemove, onRemove,
  }: {
    snapshot: ShellAppSnapshot;
    busy: boolean;
    confirmRemoveId: string | null;
    notice: string | null;
    error: string | null;
    onRequestRemove: (id: string) => void;
    onCancelRemove: () => void;
    onRemove: (id: string) => void;
  } = $props();
</script>

<div class="ca-registry">
  <h3>Installed shell apps ({snapshot.apps.length})</h3>
  {#if notice}<p class="feedback ok" role="status">{notice}</p>{/if}
  {#if error}<p class="feedback error" role="alert">{error}</p>{/if}

  {#if snapshot.apps.length === 0}
    <p class="ca-hint">No external shell apps registered yet.</p>
  {:else}
    <ul class="ca-list" aria-label="Registered shell apps">
      {#each snapshot.apps as app (app.id)}
        <li class="ca-row">
          <div class="ca-row-info">
            <div class="ca-flex">
              <strong>{app.title}</strong>
              <span class="pill" data-tone={app.renderer === "iframe" ? "ok" : "neutral"}>{app.renderer}</span>
              {#if app.blocked}<span class="pill" data-tone="danger">blocked</span>{/if}
            </div>
            <span class="ca-mono">{app.id}</span>
            {#if app.description}<span class="ca-hint">{app.description}</span>{/if}
            <code class="ca-url">{app.url ?? app.origin}</code>
            {#if app.reason}<span class="ca-error">{app.reason}</span>{/if}
          </div>
          {#if snapshot.configurable}
            <div class="ca-flex">
              {#if confirmRemoveId === app.id}
                <button type="button" class="danger" disabled={busy} onclick={() => onRemove(app.id)}>Confirm remove</button>
                <button type="button" disabled={busy} onclick={onCancelRemove}>Cancel</button>
              {:else}
                <button type="button" disabled={busy} onclick={() => onRequestRemove(app.id)}>Remove</button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if !snapshot.configurable}
    <p class="feedback pending">This app registry is managed by deployment configuration and cannot be edited here.</p>
  {/if}
</div>

<style>
  .ca-registry { display: grid; gap: 0.75rem; align-content: start; min-width: 0; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .ca-registry h3 { margin: 0; font-size: 0.875rem; }
  .ca-flex { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .ca-hint { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .ca-error { font-size: 0.75rem; color: var(--danger); overflow-wrap: anywhere; }
  .ca-mono { font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .ca-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem; }
  .ca-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--surface); }
  .ca-row-info { display: grid; gap: 0.125rem; min-width: 0; flex: 1 1 12rem; }
  .ca-url { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
