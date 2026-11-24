<script lang="ts">
  import { untrack } from "svelte";
  import type { ChannelRecordView } from "./channels-api.ts";
  import { channelHealth, healthLabel, healthTone, inboundPath, targetHint } from "./channels-draft.ts";
  import type { ChannelTestFeedback } from "./integrations-api.ts";

  let {
    row,
    workflowName,
    feedback = null,
    busy = false,
    onEdit,
    onToggle,
    onDelete,
    onTest,
    onSend,
  }: {
    row: ChannelRecordView;
    workflowName: string | null;
    feedback?: ChannelTestFeedback | null;
    busy?: boolean;
    onEdit: () => void;
    onToggle: (enabled: boolean) => void;
    onDelete: () => void;
    onTest: () => void;
    onSend: (target: string, text: string) => void;
  } = $props();

  let target = $state(untrack(() => row.defaultTarget ?? ""));
  let text = $state("Hello from MSO");
  let confirmDelete = $state(false);
  let hint = $derived(targetHint(row.provider));
  let health = $derived(channelHealth({
    enabled: row.enabled, connectionState: row.connectionState, connectionError: row.connectionError,
    lastCheckOk: row.lastCheck ? row.lastCheck.ok : null,
  }));
  let testing = $derived(feedback?.status === "testing");

  function formatTime(iso: string | null): string {
    if (!iso) return "No activity yet";
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
  }

  function deleteConfirmed() {
    confirmDelete = false;
    onDelete();
  }
</script>

<article class="card" data-tone={healthTone(health)}>
  <header class="card-head">
    <div class="card-title">
      <strong>{row.name}</strong>
      <span class="pill">{row.provider}</span>
      <span class="pill" data-tone={healthTone(health)}>{healthLabel(health)}</span>
    </div>
    <label class="card-switch" for={`enabled-${row.id}`}>
      <span class="sr-only">Enable {row.name}</span>
      <input
        id={`enabled-${row.id}`}
        type="checkbox"
        checked={row.enabled}
        disabled={busy}
        onchange={(event) => onToggle(event.currentTarget.checked)}
      />
    </label>
  </header>

  <dl class="card-facts">
    <div><dt>Inbound</dt><dd>{row.provider === "telegram" ? "Telegram webhook" : "Discord interactions"}</dd></div>
    <div><dt>Workflow</dt><dd>{workflowName ?? (row.workflowId ? "Missing or inactive" : "Not linked")}</dd></div>
    <div><dt>Default target</dt><dd>{row.defaultTarget || "Not set"}</dd></div>
    <div><dt>Last activity</dt><dd>{formatTime(row.lastActivityAt)}</dd></div>
  </dl>

  <p class="card-endpoint">
    <code>{inboundPath(row.provider, row.id)}</code>
  </p>
  <p class="card-meta">{row.credentialUser} / {row.credentialConnection}</p>
  {#if row.connectionError}<p class="card-error">Connection error: {row.connectionError}</p>{/if}
  {#if row.lastCheck}
    <p class="card-check" data-tone={row.lastCheck.ok ? "ok" : "danger"}>
      {row.lastCheck.ok ? "Verified" : "Failed"} {formatTime(row.lastCheck.at)}: {row.lastCheck.detail}
    </p>
  {/if}

  <div class="card-send">
    <div class="field">
      <label for={`target-${row.id}`}>{hint.label}</label>
      <input id={`target-${row.id}`} bind:value={target} placeholder={row.defaultTarget ?? hint.placeholder} autocomplete="off" />
    </div>
    <div class="field">
      <label for={`text-${row.id}`}>Test message</label>
      <input
        id={`text-${row.id}`}
        bind:value={text}
        maxlength={row.provider === "telegram" ? 4096 : 2000}
        autocomplete="off"
      />
    </div>
    <button type="button" disabled={busy || !text.trim() || !row.enabled} onclick={() => onSend(target, text)}>Send</button>
  </div>

  {#if feedback}
    <p
      class="feedback card-feedback"
      class:ok={feedback.status === "ok"}
      class:error={feedback.status === "error"}
      class:pending={feedback.status === "testing"}
      role={feedback.status === "error" ? "alert" : "status"}
    >{feedback.message}</p>
  {/if}

  {#if confirmDelete}
    <p class="card-confirm" role="alert">
      Delete {row.name}? Inbound events stop immediately. Bot credentials stay in Integrations.
      <span class="card-confirm-actions">
        <button type="button" class="danger" disabled={busy} onclick={deleteConfirmed}>Delete channel</button>
        <button type="button" onclick={() => { confirmDelete = false; }}>Keep channel</button>
      </span>
    </p>
  {/if}

  <footer class="card-foot">
    <button type="button" disabled={busy || testing} onclick={onTest}>
      {testing ? "Testing..." : "Test connectivity"}
    </button>
    <button type="button" onclick={onEdit}>Edit</button>
    <button type="button" disabled={busy} onclick={() => { confirmDelete = true; }}>Delete</button>
  </footer>
</article>

<style>
  .card { display: grid; gap: 0.5rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); min-width: 0; }
  .card[data-tone="ok"] { border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); }
  .card[data-tone="danger"] { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
  .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .card-title { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; }
  .card-switch input { width: 1.25rem; height: 1.25rem; min-height: 0; }
  .card-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(7rem, 100%), 1fr)); gap: 0.375rem; margin: 0; }
  .card-facts > div { padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem; background: color-mix(in srgb, var(--panel-solid) 60%, transparent); min-width: 0; }
  .card-facts dt { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; }
  .card-facts dd { margin: 0.1rem 0 0; font-size: 0.8125rem; font-weight: 600; overflow-wrap: anywhere; color: var(--text); }
  .card-endpoint { margin: 0; padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--surface); }
  .card-endpoint code { font-size: 0.7rem; overflow-wrap: anywhere; color: var(--muted); }
  .card-meta { margin: 0; font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .card-error { margin: 0; font-size: 0.75rem; color: var(--danger); }
  .card-check { margin: 0; font-size: 0.75rem; color: var(--muted); }
  .card-check[data-tone="danger"] { color: var(--danger); }
  .card-send { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr)); gap: 0.5rem; align-items: end; }
  .card-send .field input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .card-send button { align-self: end; }
  .card-feedback { margin: 0; padding: 0.5rem 0.625rem; font-size: 0.8125rem; }
  .card-confirm { margin: 0; padding: 0.5rem 0.625rem; border: 1px solid var(--danger); border-radius: 0.375rem; background: var(--danger-bg); color: var(--text); font-size: 0.8125rem; }
  .card-confirm-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
  .card-foot { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .pill { display: inline-block; padding: 0.0625rem 0.4375rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  @media (max-width: 420px) {
    .card-foot button, .card-confirm-actions button { flex: 1 1 100%; }
  }
</style>
