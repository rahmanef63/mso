<script lang="ts">
  import {
    ApiError,
    deleteAiProvider,
    discoverEndpointModels,
    FALLBACK_PROVIDERS,
    providerKeyHint,
    readAiConfig,
    readModelProviders,
    readModelsCatalog,
    saveAiConfig,
    testAiConnection,
    type AiConfig,
    type CatalogModel,
    type ModelProviderSummary,
    type ModelTestResult,
    type TokenSaverMode,
  } from "./settings-extra-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let isOwner = $derived(role === "owner");
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let cfg = $state<AiConfig | null>(null);
  let providerCatalog = $state<ModelProviderSummary[]>([...FALLBACK_PROVIDERS]);
  let catalogModels = $state<CatalogModel[]>([]);
  let modelsLoading = $state(false);
  let freeOnly = $state(false);
  let modelFilter = $state("");

  // Selected BYOK form state
  let selectedProvider = $state("anthropic");
  let selectedModel = $state("");
  let apiKeyInput = $state("");
  let tokenSaver = $state<TokenSaverMode>("off");
  let saving = $state(false);
  let notice = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  // Connection test state
  let testing = $state(false);
  let testResult = $state<ModelTestResult | null>(null);

  // Connected provider disconnect confirm
  let confirmDisconnectId = $state<string | null>(null);

  // Custom BYOK endpoint form
  let customName = $state("");
  let customBaseUrl = $state("");
  let customProtocol = $state<"openai" | "anthropic">("openai");
  let customApiKey = $state("");
  let customModelsText = $state("");
  let discovering = $state(false);
  let discoverNotice = $state<string | null>(null);
  let discoverError = $state<string | null>(null);

  let loadAbort: AbortController | undefined;
  let modelsAbort: AbortController | undefined;

  let mergedProviderOptions = $derived.by(() => {
    const ids = new Set(providerCatalog.map((p) => p.id));
    const extras = (cfg?.providers ?? [])
      .filter((p) => !ids.has(p.id))
      .map((p): ModelProviderSummary => ({
        id: p.id,
        name: p.kind === "custom" ? `${p.id} (Custom)` : p.id,
        catalogId: p.id,
        modelCount: p.models?.length ?? 0,
        freeModelCount: 0,
        freeAgentModelCount: 0,
        recommendedFreeModel: null,
      }));
    return [...providerCatalog, ...extras];
  });

  let selectedConnected = $derived(
    (cfg?.providers ?? []).find((p) => p.id === selectedProvider) ?? null,
  );

  let filteredModels = $derived.by(() => {
    const q = modelFilter.trim().toLowerCase();
    if (!q) return catalogModels;
    return catalogModels.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  });

  function formatError(err: unknown, fallback: string): string {
    return err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback;
  }

  async function loadAll() {
    if (!isOwner) return;
    loadAbort?.abort();
    const ctrl = new AbortController();
    loadAbort = ctrl;
    loading = true;
    loadError = null;
    try {
      const [configData, providersData] = await Promise.all([
        readAiConfig(ctrl.signal),
        readModelProviders(ctrl.signal).catch(() => [...FALLBACK_PROVIDERS]),
      ]);
      if (ctrl.signal.aborted) return;
      cfg = configData;
      providerCatalog = providersData.length > 0 ? providersData : [...FALLBACK_PROVIDERS];
      selectedProvider = configData.provider || "anthropic";
      selectedModel = configData.model || "";
      tokenSaver = configData.tokenSaver;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      loadError = formatError(err, "Could not load AI provider settings.");
    } finally {
      if (!ctrl.signal.aborted) loading = false;
    }
  }

  async function loadCatalogFor(provider: string, onlyFree: boolean) {
    if (!isOwner || !provider) return;
    modelsAbort?.abort();
    const ctrl = new AbortController();
    modelsAbort = ctrl;
    modelsLoading = true;
    try {
      const rows = await readModelsCatalog(provider, ctrl.signal, fetch, undefined, onlyFree);
      if (ctrl.signal.aborted) return;
      catalogModels = rows;
      if (!selectedModel && rows[0]) {
        selectedModel = rows[0].id;
      }
    } catch {
      if (!ctrl.signal.aborted) catalogModels = [];
    } finally {
      if (!ctrl.signal.aborted) modelsLoading = false;
    }
  }

  $effect(() => {
    if (!isOwner) {
      loadAbort?.abort();
      modelsAbort?.abort();
      return;
    }
    void loadAll();
    return () => {
      loadAbort?.abort();
      modelsAbort?.abort();
    };
  });

  $effect(() => {
    if (!isOwner || loading) return;
    const prov = selectedProvider;
    const onlyFree = freeOnly;
    void loadCatalogFor(prov, onlyFree);
  });

  function handleProviderChange(nextProvider: string) {
    selectedProvider = nextProvider;
    apiKeyInput = "";
    testResult = null;
    notice = null;
    actionError = null;
    if (cfg && cfg.provider === nextProvider) {
      selectedModel = cfg.model;
    } else {
      const custom = (cfg?.providers ?? []).find((p) => p.id === nextProvider);
      const summary = providerCatalog.find((p) => p.id === nextProvider);
      selectedModel = custom?.models?.[0] ?? summary?.recommendedFreeModel ?? "";
    }
  }

  async function handleSaveMain(event: SubmitEvent) {
    event.preventDefault();
    if (!isOwner || saving) return;
    saving = true;
    notice = null;
    actionError = null;
    testResult = null;
    try {
      const trimmedKey = apiKeyInput.trim();
      const trimmedModel = selectedModel.trim();
      await saveAiConfig(
        {
          provider: selectedProvider,
          ...(trimmedModel ? { model: trimmedModel } : {}),
          ...(trimmedKey ? { apiKey: trimmedKey } : {}),
        },
        new AbortController().signal,
      );
      apiKeyInput = "";
      notice = "AI provider configuration saved.";
      await loadAll();
    } catch (err) {
      actionError = formatError(err, "Could not save AI configuration.");
    } finally {
      saving = false;
    }
  }

  async function handleTokenSaverChange(nextMode: TokenSaverMode) {
    if (!isOwner || saving) return;
    tokenSaver = nextMode;
    notice = null;
    actionError = null;
    try {
      await saveAiConfig({ tokenSaver: nextMode }, new AbortController().signal);
      notice = "Output style updated.";
    } catch (err) {
      actionError = formatError(err, "Could not save output style.");
    }
  }

  async function handleTestConnection() {
    if (!isOwner || testing) return;
    testing = true;
    testResult = null;
    actionError = null;
    try {
      testResult = await testAiConnection(new AbortController().signal);
    } catch (err) {
      testResult = { ok: false, error: formatError(err, "Connection test failed.") };
    } finally {
      testing = false;
    }
  }

  async function handleDisconnectProvider(id: string) {
    if (!isOwner || saving) return;
    saving = true;
    confirmDisconnectId = null;
    notice = null;
    actionError = null;
    try {
      await deleteAiProvider(id, new AbortController().signal);
      notice = `Disconnected provider "${id}".`;
      await loadAll();
    } catch (err) {
      actionError = formatError(err, "Could not disconnect provider.");
    } finally {
      saving = false;
    }
  }

  async function handleDiscoverCustom() {
    if (!isOwner || discovering) return;
    discoverNotice = null;
    discoverError = null;
    const baseURL = customBaseUrl.trim();
    const apiKey = customApiKey.trim();
    const savedCustom = (cfg?.providers ?? []).find(
      (p) => p.kind === "custom" && p.id === customName.trim().toLowerCase(),
    );
    if (!savedCustom && (!baseURL || !apiKey)) {
      discoverError = "Enter Base URL and API key to discover models before saving.";
      return;
    }
    discovering = true;
    try {
      const res = await discoverEndpointModels(
        savedCustom && !apiKey
          ? { provider: savedCustom.id }
          : { baseURL, apiKey, protocol: customProtocol },
        new AbortController().signal,
      );
      if (!res.ok) {
        discoverError = res.error ?? "Discovery failed.";
        return;
      }
      if (res.models.length === 0) {
        discoverNotice = "Endpoint responded, but returned no model IDs.";
      } else {
        customModelsText = res.models.join(", ");
        discoverNotice = `Discovered ${res.models.length} model(s).`;
      }
    } catch (err) {
      discoverError = formatError(err, "Could not discover models.");
    } finally {
      discovering = false;
    }
  }

  async function handleDiscoverSaved(providerId: string) {
    if (!isOwner || discovering) return;
    discovering = true;
    discoverNotice = null;
    discoverError = null;
    try {
      const res = await discoverEndpointModels({ provider: providerId }, new AbortController().signal);
      if (!res.ok) {
        discoverError = res.error ?? `Discovery failed for ${providerId}.`;
        return;
      }
      discoverNotice = `Discovered ${res.models.length} model(s) on ${providerId}: ${res.models.slice(0, 6).join(", ")}`;
    } catch (err) {
      discoverError = formatError(err, "Could not discover models.");
    } finally {
      discovering = false;
    }
  }

  async function handleSaveCustom(event: SubmitEvent) {
    event.preventDefault();
    if (!isOwner || saving) return;
    const name = customName.trim();
    const baseURL = customBaseUrl.trim();
    if (!name || !baseURL) {
      actionError = "Custom provider name and Base URL are required.";
      return;
    }
    saving = true;
    notice = null;
    actionError = null;
    try {
      const models = customModelsText
        .split(/[,\n]/)
        .map((m) => m.trim())
        .filter(Boolean);
      const key = customApiKey.trim();
      await saveAiConfig(
        {
          customProvider: {
            name,
            baseURL,
            protocol: customProtocol,
            ...(key ? { apiKey: key } : {}),
            ...(models.length > 0 ? { models } : {}),
          },
          select: true,
        },
        new AbortController().signal,
      );
      customName = "";
      customBaseUrl = "";
      customApiKey = "";
      customModelsText = "";
      discoverNotice = null;
      notice = `Saved custom provider "${name}".`;
      await loadAll();
    } catch (err) {
      actionError = formatError(err, "Could not save custom provider.");
    } finally {
      saving = false;
    }
  }
</script>

<div class="ai-section" data-ai-settings-state={!isOwner ? "owner-only" : loading ? "loading" : loadError ? "error" : "ready"}>
  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to configure AI providers, model catalogs, and BYOK API keys.
    </p>
  {:else if loading}
    <p class="status-msg" role="status">Loading AI providers and model configuration...</p>
  {:else if loadError}
    <div class="feedback error" role="alert">
      <p>{loadError}</p>
      <button type="button" onclick={() => void loadAll()}>Retry</button>
    </div>
  {:else}
    {#if notice}<p class="feedback ok" role="status">{notice}</p>{/if}
    {#if actionError}<p class="feedback error" role="alert">{actionError}</p>{/if}

    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">Active Provider &amp; Model (BYOK)</h3>
        <span class="pill" data-tone={cfg?.hasApiKey ? "ok" : "warn"}>
          {cfg?.hasApiKey ? `Key set${cfg.apiKeyMasked ? ` (${cfg.apiKeyMasked})` : ""}` : "No key stored"}
        </span>
      </div>

      <form class="form-stack" onsubmit={(e) => void handleSaveMain(e)} novalidate>
        <div class="field-grid">
          <div class="field">
            <label for="ai-provider-select">Provider</label>
            <select
              id="ai-provider-select"
              value={selectedProvider}
              disabled={saving}
              onchange={(e) => handleProviderChange((e.currentTarget as HTMLSelectElement).value)}
            >
              {#each mergedProviderOptions as prov (prov.id)}
                <option value={prov.id}>
                  {prov.name}{prov.freeAgentModelCount > 0 ? ` (${prov.freeAgentModelCount} free)` : ""}
                </option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="ai-model-input">Model ID</label>
            <input
              id="ai-model-input"
              type="text"
              bind:value={selectedModel}
              disabled={saving}
              placeholder="e.g. claude-sonnet-4-5"
            />
          </div>
        </div>

        <div class="field">
          <label for="ai-api-key-input">
            API key {selectedConnected?.masked ? `(stored: ${selectedConnected.masked})` : "(stored server-side only)"}
          </label>
          <input
            id="ai-api-key-input"
            type="password"
            autocomplete="new-password"
            spellcheck={false}
            bind:value={apiKeyInput}
            disabled={saving}
            placeholder={providerKeyHint(selectedProvider)}
          />
          <p class="field-hint">
            Leave blank to keep the existing server key. Keys are masked on read and never stored in browser storage.
          </p>
        </div>

        <div class="action-row">
          <button type="submit" class="primary" disabled={saving}>
            {saving ? "Saving..." : "Save provider & model"}
          </button>
          <button type="button" disabled={testing || saving} onclick={() => void handleTestConnection()}>
            {testing ? "Testing..." : "Test active connection"}
          </button>
        </div>

        {#if testResult}
          <p class="feedback" class:ok={testResult.ok} class:error={!testResult.ok} role="status">
            {#if testResult.ok}
              Connection succeeded ({testResult.provider ?? selectedProvider}/{testResult.model ?? selectedModel}).
            {:else}
              Connection failed: {testResult.error ?? "Unknown error."}
            {/if}
          </p>
        {/if}
      </form>
    </div>

    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">Model Catalog ({filteredModels.length})</h3>
        <label class="inline-check" for="ai-free-only">
          <input id="ai-free-only" type="checkbox" bind:checked={freeOnly} />
          <span>Free models only</span>
        </label>
      </div>

      <div class="field">
        <label class="sr-only" for="ai-model-search">Search models</label>
        <input
          id="ai-model-search"
          type="search"
          bind:value={modelFilter}
          placeholder="Filter models for {selectedProvider}..."
        />
      </div>

      {#if modelsLoading}
        <p class="status-msg">Loading catalog for {selectedProvider}...</p>
      {:else if filteredModels.length === 0}
        <p class="status-msg">No catalog models matched. You can still type any model ID above.</p>
      {:else}
        <div class="catalog-list" role="listbox" aria-label="Available models">
          {#each filteredModels.slice(0, 40) as m (m.ref)}
            <button
              type="button"
              class="catalog-item"
              class:active={selectedModel === m.id}
              onclick={() => { selectedModel = m.id; }}
            >
              <span class="catalog-main">
                <strong>{m.name}</strong>
                <code>{m.id}</code>
              </span>
              <span class="badge-row">
                {#if m.free}<span class="pill" data-tone="ok">Free</span>{/if}
                {#if m.agentReady}<span class="pill">Tools</span>{/if}
                {#if m.reasoning}<span class="pill">Reasoning</span>{/if}
                {#if m.vision}<span class="pill">Vision</span>{/if}
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="settings-card">
      <h3 class="card-heading">Connected Providers ({cfg?.providers.length ?? 0})</h3>
      {#if !cfg || cfg.providers.length === 0}
        <p class="status-msg">No providers connected yet.</p>
      {:else}
        <ul class="item-list">
          {#each cfg.providers as prov (prov.id)}
            <li class="item-row">
              <div class="item-copy">
                <strong>{prov.id}</strong>
                <span class="meta-line">
                  {prov.kind}{prov.protocol ? ` / ${prov.protocol}` : ""}{prov.masked ? ` / ${prov.masked}` : ""}
                </span>
                {#if prov.baseUrl}
                  <span class="meta-line">{prov.baseUrl}</span>
                {/if}
              </div>
              <div class="item-actions">
                {#if prov.kind === "custom"}
                  <button type="button" disabled={discovering} onclick={() => void handleDiscoverSaved(prov.id)}>
                    Discover
                  </button>
                {/if}
                {#if confirmDisconnectId === prov.id}
                  <button type="button" class="danger" disabled={saving} onclick={() => void handleDisconnectProvider(prov.id)}>
                    Confirm disconnect
                  </button>
                  <button type="button" disabled={saving} onclick={() => { confirmDisconnectId = null; }}>
                    Cancel
                  </button>
                {:else}
                  <button type="button" disabled={saving} onclick={() => { confirmDisconnectId = prov.id; }}>
                    Disconnect
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="settings-card">
      <h3 class="card-heading">Add Custom Endpoint &amp; Discover Models</h3>
      <form class="form-stack" onsubmit={(e) => void handleSaveCustom(e)} novalidate>
        <div class="field-grid">
          <div class="field">
            <label for="custom-prov-name">Provider name</label>
            <input id="custom-prov-name" type="text" bind:value={customName} disabled={saving} placeholder="e.g. ollama-lan" />
          </div>
          <div class="field">
            <label for="custom-prov-proto">Protocol</label>
            <select id="custom-prov-proto" bind:value={customProtocol} disabled={saving}>
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic-compatible</option>
            </select>
          </div>
        </div>
        <div class="field-grid">
          <div class="field">
            <label for="custom-prov-url">Base URL</label>
            <input id="custom-prov-url" type="url" bind:value={customBaseUrl} disabled={saving} placeholder="https://api.example.com/v1" />
          </div>
          <div class="field">
            <label for="custom-prov-key">API key</label>
            <input
              id="custom-prov-key"
              type="password"
              autocomplete="new-password"
              spellcheck={false}
              bind:value={customApiKey}
              disabled={saving}
              placeholder="Paste endpoint key"
            />
          </div>
        </div>
        <div class="field">
          <label for="custom-prov-models">Model IDs (comma or newline separated)</label>
          <input
            id="custom-prov-models"
            type="text"
            bind:value={customModelsText}
            disabled={saving}
            placeholder="Use Discover or enter model IDs"
          />
        </div>
        {#if discoverNotice}<p class="feedback ok" role="status">{discoverNotice}</p>{/if}
        {#if discoverError}<p class="feedback error" role="alert">{discoverError}</p>{/if}
        <div class="action-row">
          <button type="button" disabled={discovering || saving} onclick={() => void handleDiscoverCustom()}>
            {discovering ? "Discovering..." : "Discover models"}
          </button>
          <button type="submit" class="primary" disabled={saving}>
            {saving ? "Saving..." : "Save custom provider"}
          </button>
        </div>
      </form>
    </div>

    <div class="settings-card">
      <h3 class="card-heading">Assistant Output Style</h3>
      <div class="field">
        <label for="ai-token-saver">Token saver style</label>
        <select
          id="ai-token-saver"
          value={tokenSaver}
          onchange={(e) => void handleTokenSaverChange((e.currentTarget as HTMLSelectElement).value as TokenSaverMode)}
        >
          <option value="off">Normal</option>
          <option value="caveman">Caveman (terse)</option>
          <option value="ponytail">Ponytail (concise senior dev)</option>
        </select>
      </div>
    </div>
  {/if}
</div>

<style>
  .ai-section { display: grid; gap: 0.75rem; min-width: 0; }
  .settings-card {
    display: grid;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    min-width: 0;
  }
  .card-heading { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .card-head-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .status-msg { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .form-stack { display: grid; gap: 0.625rem; }
  .field-grid { display: grid; gap: 0.625rem; grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr)); }
  .field-hint { margin: 0.25rem 0 0; font-size: 0.78rem; color: var(--muted); }
  .action-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .inline-check { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; color: var(--text); cursor: pointer; }
  .inline-check input { width: 1.1rem; height: 1.1rem; min-height: 1.1rem; margin: 0; padding: 0; accent-color: var(--accent); }
  .pill {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 0.72rem;
    color: var(--muted);
  }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .catalog-list {
    display: grid;
    gap: 0.375rem;
    max-height: 15rem;
    overflow-y: auto;
  }
  .catalog-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    text-align: left;
  }
  .catalog-item.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--panel-solid));
  }
  .catalog-main { display: grid; gap: 0.1rem; min-width: 0; }
  .catalog-main strong { font-size: 0.84rem; color: var(--text); overflow-wrap: anywhere; }
  .catalog-main code { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .badge-row { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
  .item-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem; }
  .item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
    flex-wrap: wrap;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
  }
  .item-copy { display: grid; gap: 0.15rem; min-width: 0; flex: 1 1 11rem; }
  .meta-line { font-size: 0.78rem; color: var(--muted); overflow-wrap: anywhere; }
  .item-actions { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
</style>
