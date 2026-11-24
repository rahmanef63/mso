<script lang="ts">
  import { ApiError } from "./integrations-api.ts";
  import {
    parseTransferDocument, prepareTransferExport, previewTransferImport, readTransferTree,
    type TransferExportPreview, type TransferImportPreview, type TransferUserPreview,
  } from "./integrations-transfer-api.ts";

  let { onClose }: { onClose: () => void } = $props();

  let tree = $state<TransferUserPreview[]>([]);
  let treeState = $state<"idle" | "loading" | "ready" | "error">("idle");
  let exportPreview = $state<TransferExportPreview | null>(null);
  let importText = $state("");
  let importPreview = $state<TransferImportPreview | null>(null);
  let busy = $state(false);
  let message = $state("");
  let error = $state("");

  let totalConnections = $derived(
    tree.reduce((sum, user) => sum + user.providers.reduce((n, provider) => n + provider.connections.length, 0), 0),
  );

  async function loadTree() {
    treeState = "loading";
    error = "";
    try {
      tree = await readTransferTree(new AbortController().signal);
      treeState = "ready";
    } catch (cause) {
      treeState = "error";
      error = cause instanceof ApiError ? cause.message : "Could not read the export tree.";
    }
  }

  async function buildExport() {
    if (busy) return;
    busy = true;
    error = "";
    message = "";
    try {
      exportPreview = await prepareTransferExport(new AbortController().signal);
      message = "Metadata bundle prepared. No credential value is included in this preview.";
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : "Could not prepare the export.";
      exportPreview = null;
    } finally {
      busy = false;
    }
  }

  async function checkImport() {
    if (busy) return;
    busy = true;
    error = "";
    message = "";
    importPreview = null;
    try {
      const document = parseTransferDocument(importText);
      importPreview = await previewTransferImport(document, new AbortController().signal);
      message = importPreview.canApply
        ? "Preview ready. Applying is a separate confirmed step and is not available in this panel."
        : "This bundle cannot apply to the current state without resolving conflicts.";
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : "Could not preview this bundle.";
    } finally {
      busy = false;
    }
  }

  function discard() {
    importText = "";
    importPreview = null;
    exportPreview = null;
    message = "";
    error = "";
  }

  $effect(() => { void loadTree(); });
  $effect(() => () => discard());
</script>

<section class="transfer" aria-labelledby="transfer-title">
  <header class="feature-header">
    <h3 id="transfer-title">Transfer connections</h3>
    <button type="button" onclick={onClose}>Close</button>
  </header>

  <p class="transfer-note">
    Read-only previews. Metadata bundles list users, connections and which fields are stored, never the values.
    Encrypted exports and every import apply run through the terminal so a passphrase never enters this window.
  </p>

  {#if error}<p class="feedback error" role="alert">{error}</p>{/if}
  {#if message}<p class="feedback ok" role="status">{message}</p>{/if}

  <div class="transfer-grid">
    <div class="transfer-panel">
      <h4>Export preview</h4>
      <p class="transfer-meta">{tree.length} profiles, {totalConnections} connections</p>
      {#if treeState === "loading"}
        <p role="status">Reading the connection tree...</p>
      {:else if treeState === "error"}
        <button type="button" onclick={() => void loadTree()}>Retry</button>
      {:else if tree.length === 0}
        <p class="transfer-meta">No stored connections to export.</p>
      {:else}
        <ul class="transfer-tree">
          {#each tree as user (user.id)}
            <li>
              <strong>{user.label}</strong>
              {#each user.providers as provider (provider.id)}
                <ul>
                  <li>
                    <span class="transfer-provider">{provider.title}</span>
                    {#each provider.connections as connection (connection.id)}
                      <span class="pill">{connection.label} · {connection.source} · {connection.storedFields} stored</span>
                    {/each}
                  </li>
                </ul>
              {/each}
            </li>
          {/each}
        </ul>
        <button type="button" class="primary" disabled={busy} onclick={() => void buildExport()}>
          {busy ? "Preparing..." : "Prepare metadata bundle"}
        </button>
      {/if}
      {#if exportPreview}
        <pre class="transfer-json" aria-label="Bundle preview (redacted)">{exportPreview.json}</pre>
        {#if exportPreview.truncated}<p class="transfer-meta">Preview truncated. The full bundle is not rendered here.</p>{/if}
      {/if}
    </div>

    <div class="transfer-panel">
      <h4>Import preview</h4>
      <div class="field">
        <label for="transfer-document">Paste a bundle document</label>
        <textarea
          id="transfer-document"
          rows="6"
          bind:value={importText}
          spellcheck="false"
          placeholder="Paste the JSON bundle produced by another MSO installation"
        ></textarea>
      </div>
      <div class="actions">
        <button type="button" disabled={busy || !importText.trim()} onclick={() => void checkImport()}>
          {busy ? "Checking..." : "Check bundle"}
        </button>
        <button type="button" disabled={!importText} onclick={discard}>Clear document</button>
      </div>
      {#if importPreview}
        <dl>
          <div><dt>Connections</dt><dd>{importPreview.connections}</dd></div>
          <div><dt>New profiles</dt><dd>{importPreview.createUsers}</dd></div>
          <div><dt>Warnings</dt><dd>{importPreview.warnings}</dd></div>
        </dl>
        {#if importPreview.requiresWarningAcceptance}
          <p class="transfer-meta">This bundle reports warnings. Resolve them in the terminal before applying.</p>
        {/if}
      {/if}
    </div>
  </div>
</section>

<style>
  .transfer { border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.875rem; background: var(--panel); display: grid; gap: 0.625rem; min-width: 0; }
  .transfer-note { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .transfer-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr)); min-width: 0; }
  .transfer-panel { display: grid; gap: 0.5rem; align-content: start; min-width: 0; }
  .transfer-panel h4 { margin: 0; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .transfer-meta { margin: 0; font-size: 0.75rem; color: var(--muted); }
  .transfer-tree { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.375rem; font-size: 0.8125rem; min-height: 0; }
  .transfer-tree ul { list-style: none; margin: 0.25rem 0 0; padding-left: 0.75rem; display: grid; gap: 0.25rem; }
  .transfer-provider { font-weight: 600; }
  .transfer-json { margin: 0; max-height: 14rem; overflow: auto; padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--surface); font-family: var(--font-mono); font-size: 0.7rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .field textarea { width: 100%; min-width: 0; font-family: var(--font-mono); font-size: 0.75rem; padding: 0.45rem 0.75rem; background: var(--panel-solid); color: var(--text); border: 1px solid var(--border); border-radius: 0.5rem; }
  .pill { display: inline-block; margin: 0.125rem 0.25rem 0 0; padding: 0.0625rem 0.4375rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  @media (max-width: 420px) { .actions button { flex: 1 1 100%; } }
</style>
