<script lang="ts">
  import { untrack } from "svelte";
  import { ApiError, canonicalProviderId, type IntegrationConnectionSummary } from "./integrations-api.ts";
  import type { IntegrationCatalogProvider } from "./integrations-workspace-api.ts";
  import {
    createIntegrationConnection, openIntegrationSetup,
    type IntegrationSetupGrant,
  } from "./integrations-setup-api.ts";
  import IntegrationSetupForm from "./IntegrationSetupForm.svelte";

  let {
    provider,
    connections,
    users,
    onClose,
    onChanged,
  }: {
    provider: IntegrationCatalogProvider;
    connections: IntegrationConnectionSummary[];
    users: string[];
    onClose: () => void;
    onChanged: (message: string) => void;
  } = $props();

  let methodId = $state(untrack(() => provider.sources[0]?.methods[0]?.id ?? "direct"));
  let profile = $state(untrack(() => users[0] ?? "default"));
  let connectionId = $state("");
  let label = $state("");
  let grant = $state<IntegrationSetupGrant | null>(null);
  let busy = $state(false);
  let error = $state("");

  let methods = $derived(provider.sources.flatMap((source) => source.methods.map((method) => ({ ...method, source: source.id }))));
  let selected = $derived(methods.find((method) => method.id === methodId) ?? methods[0] ?? null);
  let canAddSource = $derived(methods.some((method) => method.source === "direct"));

  function resetDraft() {
    connectionId = "";
    label = "";
    error = "";
    grant = null;
  }

  $effect(() => () => resetDraft());

  async function createAndConfigure() {
    if (busy || !selected) return;
    error = "";
    busy = true;
    try {
      await createIntegrationConnection({
        user: profile, provider: provider.id,
        connection: connectionId.trim(), label: label.trim() || connectionId.trim(),
        authMethod: selected.id, makeDefault: connections.length === 0,
      }, new AbortController().signal);
      await beginSetup(connectionId.trim(), selected.id);
      onChanged(`Connection ${connectionId.trim()} created for ${provider.title}.`);
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : "Could not create the connection.";
    } finally {
      busy = false;
    }
  }

  async function beginSetup(connection: string, method: string) {
    const owner = connections.find((row) => row.id === connection)?.user ?? profile;
    grant = await openIntegrationSetup(
      { provider: provider.id, method, user: owner, connection }, new AbortController().signal,
    );
  }

  async function rotate(row: IntegrationConnectionSummary) {
    if (busy) return;
    error = "";
    busy = true;
    try {
      await beginSetup(row.id, row.authMethod);
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : "Could not open the secure setup session.";
    } finally {
      busy = false;
    }
  }

  function tone(state: string): "ok" | "warn" | "danger" | "neutral" {
    if (state === "verified" || state === "ACTIVE") return "ok";
    if (state === "incomplete" || state === "configured" || state === "authorization-required") return "warn";
    if (state === "invalid" || state === "unavailable") return "danger";
    return "neutral";
  }
</script>

<section class="detail" aria-labelledby="provider-detail-title">
  <header class="feature-header">
    <h3 id="provider-detail-title">{provider.title}</h3>
    <button type="button" onclick={onClose}>Close</button>
  </header>
  <p class="detail-desc">{provider.description}</p>

  {#if provider.id === "convex"}
    <p class="detail-note">
      One Convex provider covers both deployment kinds. Cloud connections use a team token or deployment
      key, self-hosted connections use a deployment URL and admin key. There is no separate cloud card.
    </p>
  {/if}

  {#if error}<p class="feedback error" role="alert">{error}</p>{/if}

  {#if grant}
    <IntegrationSetupForm
      {grant}
      onCancel={() => { grant = null; }}
      onSaved={(message) => { grant = null; onChanged(message); }}
    />
  {:else}
    <h4 class="detail-sub">Existing connections</h4>
    {#if connections.length === 0}
      <p class="detail-empty">No connections yet. Create a named connection, then save its credential.</p>
    {:else}
      <ul class="detail-list">
        {#each connections as row (`${row.user}:${row.id}`)}
          <li class="detail-row">
            <div class="detail-info">
              <div class="detail-heading">
                <strong>{row.label}</strong>
                <code>{canonicalProviderId(row.provider)}/{row.id}</code>
                <span class="pill" data-tone={tone(row.state)}>{row.state}</span>
                {#if row.isDefault}<span class="pill" data-tone="ok">default</span>{/if}
              </div>
              <p class="detail-meta">{row.user} · {row.source} · {row.authMethod}</p>
              {#if row.missing.length > 0}<p class="detail-warn">Missing: {row.missing.join(", ")}</p>{/if}
            </div>
            {#if row.source === "direct"}
              <button type="button" disabled={busy} onclick={() => void rotate(row)}>
                {row.missing.length ? "Finish setup" : "Rotate credential"}
              </button>
            {:else}
              <p class="detail-meta">Authorize this connection in its provider. MSO never stores those tokens.</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if canAddSource}
      <h4 class="detail-sub">Add a connection</h4>
      <div class="detail-form">
        <div class="field">
          <label for="detail-method">Credential method</label>
          <select id="detail-method" bind:value={methodId} onchange={() => { connectionId = ""; label = ""; }}>
            {#each methods as method (method.id)}
              <option value={method.id}>{method.label}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="detail-profile">Credential profile</label>
          <select id="detail-profile" bind:value={profile}>
            {#each (users.length ? users : ["default"]) as user (user)}<option value={user}>{user}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="detail-connection">Connection id</label>
          <input id="detail-connection" bind:value={connectionId} placeholder="production" autocomplete="off" />
        </div>
        <div class="field">
          <label for="detail-label">Label</label>
          <input id="detail-label" bind:value={label} placeholder={selected?.label ?? provider.title} autocomplete="off" />
        </div>
        <div class="actions">
          <button type="button" class="primary" disabled={busy || !connectionId.trim()} onclick={() => void createAndConfigure()}>
            {busy ? "Working..." : "Create and configure"}
          </button>
        </div>
        {#if selected}
          <p class="detail-note">{selected.fields.length} credential field(s), stored owner-only under {selected.source}.</p>
        {/if}
      </div>
    {:else}
      <p class="detail-note">
        This provider is authorized through {provider.sources.map((source) => source.label).join(" or ")}.
        MSO stores the routing identifiers, never the provider tokens.
      </p>
    {/if}
  {/if}
</section>

<style>
  .detail { border: 1px solid var(--accent); border-radius: 0.5rem; padding: 0.875rem; background: var(--panel); display: grid; gap: 0.5rem; }
  .detail-desc { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .detail-note { margin: 0; font-size: 0.75rem; color: var(--muted); }
  .detail-sub { margin: 0.5rem 0 0; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .detail-empty { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .detail-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .detail-row { display: flex; gap: 0.625rem; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem; }
  .detail-info { display: grid; gap: 0.2rem; min-width: 0; flex: 1 1 12rem; }
  .detail-heading { display: flex; gap: 0.375rem; flex-wrap: wrap; align-items: center; }
  .detail-heading code { font-size: 0.75rem; color: var(--muted); }
  .detail-meta { margin: 0; font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .detail-warn { margin: 0; font-size: 0.75rem; color: var(--warn); }
  .detail-form { display: grid; gap: 0.625rem; min-width: 0; }
  .field input, .field select { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  @media (max-width: 420px) {
    .detail { padding: 0.625rem; }
    .actions button { flex: 1 1 100%; }
  }
</style>
