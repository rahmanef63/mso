<script lang="ts">
  import type { ChannelCredentialOption, ChannelDraft, ChannelGroupOption, ChannelWorkflowOption } from "./channels-api.ts";
  import {
    channelHealth, draftDirty, draftValid, healthLabel, healthTone, inboundPath, splitCredential,
    targetHint, type ChannelDraftState,
  } from "./channels-draft.ts";
  import type { ChannelRecordView } from "./channels-api.ts";
  import { untrack } from "svelte";

  let {
    row = null,
    credentials,
    workflows,
    groups,
    busy = false,
    error = "",
    onSave,
    onCancel,
  }: {
    row?: ChannelRecordView | null;
    credentials: ChannelCredentialOption[];
    workflows: ChannelWorkflowOption[];
    groups: ChannelGroupOption[];
    busy?: boolean;
    error?: string;
    onSave: (draft: ChannelDraft) => void;
    onCancel: () => void;
  } = $props();

  // The draft is seeded once from the row the editor was opened for: remounting on a new
  // row is the caller's contract (`{#if editor}`), so capturing the initial value is intended.
  let initial = $state<ChannelDraftState>(untrack(() => ({
    name: row?.name ?? "",
    provider: row?.provider ?? "telegram",
    credential: row ? `${row.credentialUser}::${row.credentialConnection}` : "",
    defaultTarget: row?.defaultTarget ?? "",
    workflowId: row?.workflowId ?? "",
    agentGroupId: row?.agentGroupId ?? "",
    enabled: row?.enabled ?? true,
  })));
  let draft = $state<ChannelDraftState>({ ...initial });
  let confirmDiscard = $state(false);
  let attempted = $state(false);

  let options = $derived(credentials.filter((option) => option.provider === draft.provider));
  let hint = $derived(targetHint(draft.provider));
  let valid = $derived(draftValid(draft));
  let dirty = $derived(draftDirty(draft, initial));

  function changeProvider(next: "telegram" | "discord") {
    draft = { ...draft, provider: next, credential: "" };
  }

  function cancel() {
    if (dirty && !confirmDiscard) { confirmDiscard = true; return; }
    confirmDiscard = false;
    onCancel();
  }

  function submit(event: Event) {
    event.preventDefault();
    attempted = true;
    const parts = splitCredential(draft.credential);
    if (!valid || !parts) return;
    onSave({
      name: draft.name, provider: draft.provider,
      credentialUser: parts.user, credentialConnection: parts.connection,
      enabled: draft.enabled, defaultTarget: draft.defaultTarget,
      workflowId: draft.workflowId, agentGroupId: draft.agentGroupId,
    });
  }

  const health = $derived(row
    ? channelHealth({
        enabled: row.enabled, connectionState: row.connectionState, connectionError: row.connectionError,
        lastCheckOk: row.lastCheck ? row.lastCheck.ok : null,
      })
    : null);
</script>
<form class="editor" aria-labelledby="channel-editor-title" onsubmit={submit}>
  <header class="feature-header">
    <h3 id="channel-editor-title">{row ? "Edit channel" : "Add channel"}</h3>
    {#if health}<span class="pill" data-tone={healthTone(health)}>{healthLabel(health)}</span>{/if}
  </header>
  <p class="editor-note">
    A channel stores a reference to an Integration connection. Bot tokens never live in a channel record.
  </p>

  <div class="field">
    <label for="channel-name">Name</label>
    <input id="channel-name" bind:value={draft.name} maxlength="120" placeholder="Support bot" autocomplete="off" aria-invalid={attempted && !draft.name.trim()} />
  </div>

  <div class="field">
    <label for="channel-provider">Provider</label>
    <select id="channel-provider" value={draft.provider} onchange={(event) => changeProvider(event.currentTarget.value as "telegram" | "discord")}>
      <option value="telegram">Telegram</option>
      <option value="discord">Discord</option>
    </select>
  </div>

  <div class="field">
    <label for="channel-credential">Integration connection</label>
    {#if options.length === 0}
      <p class="editor-empty">
        No {draft.provider} bot connection is available. Create and verify one in Integrations first.
      </p>
    {:else}
      <select id="channel-credential" bind:value={draft.credential}>
        <option value="">Choose a connection</option>
        {#each options as option (`${option.user}:${option.connection}`)}
          <option value={`${option.user}::${option.connection}`}>{option.userLabel} / {option.label} · {option.state}</option>
        {/each}
      </select>
    {/if}
  </div>

  <div class="field">
    <label for="channel-target">{hint.label}</label>
    <input id="channel-target" bind:value={draft.defaultTarget} placeholder={hint.placeholder} autocomplete="off" />
  </div>

  <div class="field">
    <label for="channel-workflow">Inbound workflow</label>
    <select id="channel-workflow" bind:value={draft.workflowId}>
      <option value="">Receive only (no workflow)</option>
      {#each workflows as workflow (workflow.id)}<option value={workflow.id}>{workflow.name}</option>{/each}
    </select>
    <p class="editor-help">Only active workflows with a Channel Trigger node are listed.</p>
  </div>

  <div class="field">
    <label for="channel-group">Agent group (Telegram discussion)</label>
    <select id="channel-group" bind:value={draft.agentGroupId}>
      <option value="">Not linked</option>
      {#each groups as group (group.id)}<option value={group.id}>{group.name}</option>{/each}
    </select>
  </div>

  <label class="editor-toggle" for="channel-enabled">
    <span>
      <span class="editor-toggle-title">Enabled</span>
      <span class="editor-help">Allow outbound sends and verified inbound events.</span>
    </span>
    <input id="channel-enabled" type="checkbox" bind:checked={draft.enabled} />
  </label>

  {#if row}
    <p class="editor-help">
      Inbound endpoint: <code>{inboundPath(row.provider, row.id)}</code>
    </p>
  {/if}

  {#if error}<p class="feedback error" role="alert">{error}</p>{/if}
  {#if confirmDiscard}
    <p class="feedback pending" role="alert">
      Discard unsaved changes to this channel?
      <span class="editor-confirm-actions">
        <button type="button" class="danger" onclick={() => { confirmDiscard = false; onCancel(); }}>Discard</button>
        <button type="button" onclick={() => { confirmDiscard = false; }}>Keep editing</button>
      </span>
    </p>
  {/if}

  <div class="actions">
    <button type="submit" class="primary" disabled={busy || !valid}>{busy ? "Saving..." : row ? "Save channel" : "Create channel"}</button>
    <button type="button" disabled={busy} onclick={cancel}>Cancel</button>
  </div>
</form>

<style>
  .editor { border: 1px solid var(--accent); border-radius: 0.5rem; padding: 0.875rem; background: var(--panel); display: grid; gap: 0.625rem; min-width: 0; }
  .editor-note { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .editor-help { margin: 0; font-size: 0.75rem; color: var(--muted); }
  .editor-help code { font-size: 0.7rem; overflow-wrap: anywhere; }
  .editor-empty { margin: 0; padding: 0.5rem; border: 1px dashed var(--border); border-radius: 0.375rem; font-size: 0.8125rem; color: var(--muted); }
  .editor-toggle { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.5rem 0.625rem; border: 1px solid var(--border); border-radius: 0.375rem; }
  .editor-toggle-title { display: block; font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .editor-toggle input { width: 1.25rem; height: 1.25rem; min-height: 0; }
  .editor-confirm-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
  .field input, .field select { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .field input[aria-invalid="true"] { border-color: var(--danger); }  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  @media (max-width: 420px) {
    .editor { padding: 0.625rem; }
    .actions button, .editor-confirm-actions button { flex: 1 1 100%; }
  }
</style>
