<script lang="ts">
  import { untrack } from "svelte";
  import { ApiError } from "./infra-api.ts";
  import { openIntegrationSetup, type IntegrationSetupGrant } from "../integrations/integrations-setup-api.ts";
  import type { IntegrationCatalogField, IntegrationCatalogProvider } from "../integrations/integrations-workspace-api.ts";
  import IntegrationSetupForm from "../integrations/IntegrationSetupForm.svelte";

  let {
    provider,
    users,
    onClose,
    onSaved,
  }: {
    provider: IntegrationCatalogProvider;
    users: string[];
    onClose: () => void;
    onSaved: (message: string) => void;
  } = $props();

  let direct = $derived(provider.sources.find((source) => source.id === "direct") ?? null);
  let methods = $derived(direct?.methods ?? []);
  let methodId = $state(untrack(() => methods[0]?.id ?? ""));
  let profile = $state(untrack(() => users[0] ?? "default"));
  let connectionId = $state("default");
  let grant = $state<IntegrationSetupGrant | null>(null);
  let busy = $state(false);
  let error = $state("");

  let selected = $derived(methods.find((method) => method.id === methodId) ?? methods[0] ?? null);
  // One Convex product, two credential shapes: this is a project dimension, not a second provider.
  let convexMethods = $derived(provider.id === "convex" ? methods : []);

  function methodLabel(id: string): string {
    return methods.find((method) => method.id === id)?.label ?? id;
  }

  $effect(() => () => { grant = null; error = ""; });

  async function begin() {
    if (busy || !selected) return;
    error = "";
    busy = true;
    try {
      grant = await openIntegrationSetup({
        provider: provider.id, method: selected.id, user: profile, connection: connectionId.trim() || "default",
      }, new AbortController().signal);
    } catch (cause) {
      error = cause instanceof ApiError
        ? cause.message
        : "Could not open the secure setup session. The connection must already exist.";
    } finally {
      busy = false;
    }
  }

  const fieldSummary = (fields: IntegrationCatalogField[]): string =>
    fields.map((field) => `${field.label}${field.required ? " *" : ""}`).join(", ");
</script>

<section class="drawer" aria-labelledby="infra-setup-title">
  <header class="feature-header">
    <h3 id="infra-setup-title">Configure {provider.title}</h3>
    <button type="button" onclick={onClose}>Close</button>
  </header>
  <p class="drawer-desc">{provider.description}</p>

  {#if error}<p class="feedback error" role="alert">{error}</p>{/if}

  {#if grant}
    <IntegrationSetupForm
      {grant}
      onCancel={() => { grant = null; }}
      onSaved={(message) => { grant = null; onSaved(message); }}
    />
  {:else if methods.length === 0}
    <p class="drawer-note">
      {provider.title} is authorized through {provider.sources.map((source) => source.label).join(" or ")}. MSO keeps the
      routing identifiers and never stores those provider tokens.
    </p>
  {:else}
    {#if convexMethods.length > 1}
      <fieldset class="drawer-methods">
        <legend>Deployment</legend>
        {#each convexMethods as method (method.id)}
          <label class="drawer-method">
            <input type="radio" name="convex-method" value={method.id} checked={methodId === method.id}
              onchange={() => { methodId = method.id; }} />
            <span>
              <span class="drawer-method-title">{method.label}</span>
              <span class="drawer-method-fields">{fieldSummary(method.fields)}</span>
            </span>
          </label>
        {/each}
      </fieldset>
    {:else}
      <div class="field">
        <label for="infra-method">Credential method</label>
        <select id="infra-method" bind:value={methodId}>
          {#each methods as method (method.id)}<option value={method.id}>{method.label}</option>{/each}
        </select>
      </div>
    {/if}

    <div class="drawer-row">
      <div class="field">
        <label for="infra-profile">Credential profile</label>
        <select id="infra-profile" bind:value={profile}>
          {#each (users.length ? users : ["default"]) as user (user)}<option value={user}>{user}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="infra-connection">Connection</label>
        <input id="infra-connection" bind:value={connectionId} placeholder="default" autocomplete="off" />
      </div>
    </div>

    {#if selected}
      <dl class="drawer-fields">
        {#each selected.fields as field (field.key)}
          <div>
            <dt>{field.label}{field.required ? " *" : ""}</dt>
            <dd>{field.description}</dd>
          </div>
        {/each}
      </dl>
    {/if}

    <div class="actions">
      <button type="button" class="primary" disabled={busy || !selected} onclick={() => void begin()}>
        {busy ? "Opening..." : `Open secure setup for ${methodLabel(methodId)}`}
      </button>
    </div>
    <p class="drawer-note">
      The setup session targets an existing named connection and expires in about ten minutes. Values are typed into
      this panel and never leave it in plain text.
    </p>
  {/if}
</section>

<style>
  .drawer { border: 1px solid var(--accent); border-radius: 0.5rem; padding: 0.875rem; background: var(--panel); display: grid; gap: 0.625rem; min-width: 0; }
  .drawer-desc { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .drawer-note { margin: 0; font-size: 0.75rem; color: var(--muted); }
  .drawer-row { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr)); }
  .drawer-methods { display: grid; gap: 0.375rem; margin: 0; padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem; min-width: 0; }
  .drawer-methods legend { padding: 0 0.25rem; font-size: 0.75rem; font-weight: 600; color: var(--muted); }
  .drawer-method { display: flex; gap: 0.5rem; align-items: flex-start; padding: 0.375rem; border-radius: 0.25rem; }
  .drawer-method input { margin-top: 0.15rem; }
  .drawer-method-title { display: block; font-size: 0.8125rem; font-weight: 600; color: var(--text); }
  .drawer-method-fields { display: block; font-size: 0.7rem; color: var(--muted); overflow-wrap: anywhere; }
  .drawer-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr)); gap: 0.375rem; margin: 0; }
  .drawer-fields > div { padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem; background: color-mix(in srgb, var(--panel-solid) 60%, transparent); min-width: 0; }
  .drawer-fields dt { font-size: 0.7rem; font-weight: 600; color: var(--text); }
  .drawer-fields dd { margin: 0.1rem 0 0; font-size: 0.7rem; color: var(--muted); overflow-wrap: anywhere; }
  .field input, .field select { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  @media (max-width: 420px) { .actions button { flex: 1 1 100%; } }
</style>
