<script lang="ts">
  import {
    saveIntegrationSetup,
    type IntegrationSetupGrant,
  } from "./integrations-setup-api.ts";
  import { ApiError } from "./integrations-api.ts";

  let {
    grant,
    onSaved,
    onCancel,
  }: {
    grant: IntegrationSetupGrant;
    onSaved: (message: string) => void;
    onCancel: () => void;
  } = $props();

  // Field values live only in this component and are wiped on save, discard and unmount.
  let values = $state<Record<string, string>>({});
  let busy = $state(false);
  let error = $state("");
  let attempted = $state(false);

  let missing = $derived(
    grant.schema.fields.filter((field) => field.required && !field.stored && !(values[field.key] ?? "").trim()),
  );

  function clearDraft() {
    values = {};
  }

  $effect(() => () => clearDraft());

  function cancel() {
    clearDraft();
    error = "";
    onCancel();
  }

  async function submit() {
    if (busy) return;
    attempted = true;
    error = "";
    if (missing.length > 0) {
      error = `Fill in: ${missing.map((field) => field.label).join(", ")}.`;
      return;
    }
    busy = true;
    try {
      const result = await saveIntegrationSetup(grant.token, values, new AbortController().signal);
      clearDraft();
      onSaved(result.verified
        ? `${grant.schema.title} verified and saved.`
        : `${grant.schema.title} saved. Verification is unavailable for this provider, so nothing was probed.`);
    } catch (cause) {
      error = cause instanceof ApiError
        ? cause.message
        : "The secure setup request failed. The credential was not saved.";
      if (cause instanceof ApiError && cause.status === 401) onCancel();
    } finally {
      busy = false;
    }
  }
</script>

<section class="setup" aria-labelledby="setup-title">
  <header class="feature-header">
    <h3 id="setup-title">Configure {grant.schema.title}</h3>
    <span class="pill">{grant.schema.methodId}</span>
  </header>
  <p class="setup-meta">
    {grant.schema.label} / {grant.schema.connection} · {grant.schema.scope || "connection"}
  </p>
  <p class="setup-note">
    Values go straight to MSO's owner-only store through a one-time grant. They are never echoed back,
    logged or kept after this panel closes.
  </p>

  {#if grant.schema.steps.length > 0}
    <details class="setup-steps">
      <summary>Where to get these credentials</summary>
      <ol>
        {#each grant.schema.steps as step}<li>{step}</li>{/each}
      </ol>
    </details>
  {/if}

  <form class="setup-form" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    {#each grant.schema.fields as field (field.key)}
      {@const touched = attempted && field.required && !field.stored && !(values[field.key] ?? "").trim()}
      <div class="field">
        <label for={`setup-${field.key}`}>
          {field.label}{field.required ? " *" : ""}
        </label>
        <input
          id={`setup-${field.key}`}
          type={field.secret ? "password" : "text"}
          autocomplete="off"
          spellcheck="false"
          placeholder={field.secret && field.stored ? "Stored. Leave blank to keep it." : field.placeholder ?? ""}
          aria-invalid={touched}
          value={values[field.key] ?? ""}
          oninput={(event) => { values = { ...values, [field.key]: event.currentTarget.value }; }}
        />
        <p class="setup-help">{field.description}</p>
        {#if field.stored}<p class="setup-stored">A value is already stored for this field.</p>{/if}
      </div>
    {/each}

    {#if error}<p class="feedback error" role="alert">{error}</p>{/if}

    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>{busy ? "Saving..." : "Save and verify"}</button>
      <button type="button" disabled={busy} onclick={cancel}>Discard draft</button>
    </div>
  </form>
</section>

<style>
  .setup { border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.875rem; background: var(--panel); }
  .setup-meta { margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--muted); }
  .setup-note { margin: 0.5rem 0 0.75rem; font-size: 0.8125rem; color: var(--muted); }
  .setup-steps { margin-bottom: 0.75rem; font-size: 0.8125rem; }
  .setup-steps summary { cursor: pointer; font-weight: 600; color: var(--text); }
  .setup-steps ol { margin: 0.5rem 0 0; padding-left: 1.25rem; color: var(--muted); display: grid; gap: 0.25rem; }
  .setup-form { display: grid; gap: 0.75rem; min-width: 0; }
  .setup-help { margin: 0; font-size: 0.75rem; color: var(--muted); }
  .setup-stored { margin: 0; font-size: 0.75rem; color: var(--ok); }
  .field input { width: 100%; min-width: 0; min-height: var(--ui-control-height); font-family: var(--font-mono); }
  .field input[aria-invalid="true"] { border-color: var(--danger); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  @media (max-width: 420px) {
    .setup { padding: 0.625rem; }
    .actions button { flex: 1 1 100%; }
  }
</style>
