<script lang="ts">
  import "./McpSection.css";
  import {
    ApiError,
    buildMcpClientGuides,
    formatTimestamp,
    mintMcpToken,
    normalizeMcpOrigin,
    readMcpActivity,
    readMcpStatus,
    revokeMcpToken,
    type McpActivityEntry,
    type McpClientGuideId,
    type McpScope,
    type McpStatusPayload,
  } from "./settings-extra-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let isOwner = $derived(role === "owner");
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let status = $state<McpStatusPayload | null>(null);
  let activity = $state<McpActivityEntry[]>([]);
  let activityError = $state<string | null>(null);

  // Client guide selection & copy state
  let selectedGuide = $state<McpClientGuideId>("claude-code");
  let copiedKey = $state<string | null>(null);

  // Mint PAT form
  let patLabel = $state("");
  let patScope = $state<McpScope>("read");
  let patTtl = $state<0 | 7 | 30 | 90>(30);
  let minting = $state(false);
  let mintedToken = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let actionNotice = $state<string | null>(null);

  // Token filtering & inline 2-step revoke confirm
  let showInactive = $state(false);
  let pendingRevoke = $state<{ id: string; label: string } | null>(null);
  let revoking = $state(false);

  // Activity filter
  let activityFilter = $state("");

  let abortCtrl: AbortController | undefined;

  let effectiveOrigin = $derived(
    normalizeMcpOrigin(status?.origin || (typeof window !== "undefined" ? window.location.origin : "")),
  );
  let mcpEndpoint = $derived(`${effectiveOrigin}/mcp`);
  let guides = $derived(buildMcpClientGuides(effectiveOrigin, mintedToken ?? undefined));
  let activeGuide = $derived(guides.find((g) => g.id === selectedGuide) ?? guides[0]);

  let activeTokens = $derived((status?.tokens ?? []).filter((t) => t.status === "active"));
  let visibleTokens = $derived(showInactive ? (status?.tokens ?? []) : activeTokens);

  let allowedScopes = $derived.by<McpScope[]>(() => {
    const max = status?.maxScope ?? "read";
    if (max === "exec") return ["read", "write", "exec"];
    if (max === "write") return ["read", "write"];
    return ["read"];
  });

  let filteredActivity = $derived.by(() => {
    const q = activityFilter.trim().toLowerCase();
    if (!q) return activity;
    return activity.filter((e) =>
      `${e.tool} ${e.state} ${e.actor ?? ""} ${e.target ?? ""} ${e.detail ?? ""}`.toLowerCase().includes(q),
    );
  });

  function formatError(err: unknown, fallback: string): string {
    return err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback;
  }

  async function refreshAll() {
    if (!isOwner) return;
    abortCtrl?.abort();
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    loading = true;
    loadError = null;
    activityError = null;
    try {
      const [mcpData, activityData] = await Promise.all([
        readMcpStatus(ctrl.signal),
        readMcpActivity(ctrl.signal, fetch, undefined, 40).catch((err) => {
          activityError = formatError(err, "Could not load recent MCP activity.");
          return [] as McpActivityEntry[];
        }),
      ]);
      if (ctrl.signal.aborted) return;
      status = mcpData;
      activity = activityData;
      if (!allowedScopes.includes(patScope)) patScope = "read";
    } catch (err) {
      if (ctrl.signal.aborted) return;
      loadError = formatError(err, "Could not load MCP server status.");
    } finally {
      if (!ctrl.signal.aborted) loading = false;
    }
  }

  $effect(() => {
    if (!isOwner) {
      abortCtrl?.abort();
      return;
    }
    void refreshAll();
    return () => {
      abortCtrl?.abort();
    };
  });

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      setTimeout(() => {
        if (copiedKey === key) copiedKey = null;
      }, 2000);
    } catch {
      actionError = "Clipboard copy failed. Select the text and copy it manually.";
    }
  }

  async function handleMintPat(event: SubmitEvent) {
    event.preventDefault();
    if (!isOwner || minting) return;
    const cleanLabel = patLabel.trim();
    if (!cleanLabel) {
      actionError = "Enter a label for the Personal Access Token.";
      return;
    }
    minting = true;
    actionError = null;
    actionNotice = null;
    try {
      const res = await mintMcpToken(
        { label: cleanLabel, scope: patScope, ttlDays: patTtl },
        new AbortController().signal,
      );
      mintedToken = res.token;
      patLabel = "";
      actionNotice = `Token "${cleanLabel}" created. Copy it now because it will not be shown again.`;
      await refreshAll();
    } catch (err) {
      actionError = formatError(err, "Could not create MCP token.");
    } finally {
      minting = false;
    }
  }

  async function handleConfirmRevoke() {
    if (!isOwner || !pendingRevoke || revoking) return;
    revoking = true;
    actionError = null;
    actionNotice = null;
    const target = pendingRevoke;
    try {
      const count = await revokeMcpToken(target.id, new AbortController().signal);
      pendingRevoke = null;
      actionNotice = `Revoked ${count} token(s) for ${target.label}.`;
      await refreshAll();
    } catch (err) {
      actionError = formatError(err, "Could not revoke MCP token.");
    } finally {
      revoking = false;
    }
  }
</script>

<div class="mcp-section" data-mcp-settings-state={!isOwner ? "owner-only" : loading ? "loading" : loadError ? "error" : "ready"}>
  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to manage MCP server connections, access tokens, and tool activity.
    </p>
  {:else if loading}
    <p class="status-msg" role="status">Loading MCP server status and tokens...</p>
  {:else if loadError}
    <div class="feedback error" role="alert">
      <p>{loadError}</p>
      <button type="button" onclick={() => void refreshAll()}>Retry</button>
    </div>
  {:else if status}
    {#if actionNotice}<p class="feedback ok" role="status">{actionNotice}</p>{/if}
    {#if actionError}<p class="feedback error" role="alert">{actionError}</p>{/if}

    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">MCP Server Status</h3>
        <div class="badge-row">
          <span class="pill" data-tone={status.enabled ? "ok" : "warn"}>
            {status.enabled ? "Enabled" : "Disabled"}
          </span>
          <button type="button" onclick={() => void refreshAll()}>Refresh</button>
        </div>
      </div>

      <dl class="metric-grid">
        <div class="metric-box">
          <dt>Endpoint</dt>
          <dd class="copy-line">
            <code>{mcpEndpoint}</code>
            <button type="button" onclick={() => void copyText("endpoint", mcpEndpoint)}>
              {copiedKey === "endpoint" ? "Copied" : "Copy"}
            </button>
          </dd>
        </div>
        <div class="metric-box">
          <dt>Max scope</dt>
          <dd><code>{status.maxScope}</code></dd>
        </div>
        <div class="metric-box">
          <dt>Toolset</dt>
          <dd>{status.toolset.count} tools {status.toolset.version ? `(v${status.toolset.version})` : ""}</dd>
        </div>
        {#if status.targetIdentity?.hostname}
          <div class="metric-box">
            <dt>Host identity</dt>
            <dd>{status.targetIdentity.hostname} ({status.targetIdentity.platform ?? "host"})</dd>
          </div>
        {/if}
      </dl>
    </div>

    <div class="settings-card">
      <h3 class="card-heading">Client Setup Guide</h3>
      <div class="tab-strip" role="tablist" aria-label="MCP clients">
        {#each guides as guide (guide.id)}
          <button
            type="button"
            role="tab"
            class="tab-btn"
            class:active={selectedGuide === guide.id}
            aria-selected={selectedGuide === guide.id}
            onclick={() => { selectedGuide = guide.id; }}
          >
            {guide.label}
          </button>
        {/each}
      </div>

      {#if activeGuide}
        <p class="status-msg">{activeGuide.summary}</p>
        <ol class="steps-list">
          {#each activeGuide.steps as step, idx (idx)}
            <li>{step}</li>
          {/each}
        </ol>
        <div class="snippet-box">
          <div class="snippet-head">
            <span>{activeGuide.snippetLabel}</span>
            <button type="button" onclick={() => void copyText(`guide-${activeGuide.id}`, activeGuide.snippet)}>
              {copiedKey === `guide-${activeGuide.id}` ? "Copied" : "Copy snippet"}
            </button>
          </div>
          <pre class="snippet-code"><code>{activeGuide.snippet}</code></pre>
        </div>
      {/if}
    </div>

    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">Access Tokens ({activeTokens.length} active)</h3>
        <div class="badge-row">
          {#if status.tokens.length > activeTokens.length}
            <button type="button" aria-pressed={showInactive} onclick={() => { showInactive = !showInactive; }}>
              {showInactive ? "Hide inactive" : "Show all"}
            </button>
          {/if}
          {#if activeTokens.length > 1}
            <button
              type="button"
              class="danger"
              disabled={revoking}
              onclick={() => { pendingRevoke = { id: "all", label: `all ${activeTokens.length} active tokens` }; }}
            >
              Revoke all
            </button>
          {/if}
        </div>
      </div>

      {#if mintedToken}
        <div class="minted-banner" role="status">
          <p class="minted-title">New Personal Access Token (shown once)</p>
          <div class="copy-line">
            <code class="token-raw">{mintedToken}</code>
            <button type="button" class="primary" onclick={() => void copyText("pat", mintedToken ?? "")}>
              {copiedKey === "pat" ? "Copied" : "Copy token"}
            </button>
            <button type="button" onclick={() => { mintedToken = null; }}>Dismiss</button>
          </div>
        </div>
      {/if}

      {#if pendingRevoke}
        <div class="confirm-box" role="alert">
          <p>Revoke <strong>{pendingRevoke.label}</strong>? Clients using this credential will lose access immediately.</p>
          <div class="action-row">
            <button type="button" class="danger" disabled={revoking} onclick={() => void handleConfirmRevoke()}>
              {revoking ? "Revoking..." : "Confirm revoke"}
            </button>
            <button type="button" disabled={revoking} onclick={() => { pendingRevoke = null; }}>
              Cancel
            </button>
          </div>
        </div>
      {/if}

      <form class="pat-form" onsubmit={(e) => void handleMintPat(e)} novalidate>
        <div class="field-grid">
          <div class="field">
            <label for="mcp-pat-label">Token label</label>
            <input
              id="mcp-pat-label"
              type="text"
              maxlength={80}
              bind:value={patLabel}
              disabled={!status.enabled || minting}
              placeholder="e.g. Cursor laptop"
            />
          </div>
          <div class="field">
            <label for="mcp-pat-scope">Scope</label>
            <select id="mcp-pat-scope" bind:value={patScope} disabled={!status.enabled || minting}>
              {#each allowedScopes as sc (sc)}
                <option value={sc}>{sc}</option>
              {/each}
            </select>
          </div>
          <div class="field">
            <label for="mcp-pat-ttl">Expires</label>
            <select
              id="mcp-pat-ttl"
              value={String(patTtl)}
              disabled={!status.enabled || minting}
              onchange={(e) => { patTtl = Number((e.currentTarget as HTMLSelectElement).value) as 0 | 7 | 30 | 90; }}
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="0">Never</option>
            </select>
          </div>
        </div>
        <div class="action-row">
          <button type="submit" class="primary" disabled={!status.enabled || minting}>
            {minting ? "Generating..." : "Generate token (PAT)"}
          </button>
        </div>
      </form>

      {#if visibleTokens.length === 0}
        <p class="status-msg">No active MCP tokens yet.</p>
      {:else}
        <ul class="item-list">
          {#each visibleTokens as tok (tok.id)}
            <li class="item-row">
              <div class="item-copy">
                <div class="badge-row">
                  <strong>{tok.label}</strong>
                  <span class="pill" data-tone={tok.status === "active" ? "ok" : "warn"}>{tok.status}</span>
                  <span class="pill">{tok.scope}</span>
                </div>
                <span class="meta-line">
                  Created: {formatTimestamp(tok.createdAt)} | Expires: {tok.expiresAt === 0 ? "Never" : formatTimestamp(tok.expiresAt)}
                </span>
                <span class="meta-line">
                  Last used: {formatTimestamp(tok.lastUsedAt)} | Client: {tok.clientId}
                </span>
              </div>
              {#if tok.status === "active"}
                <button
                  type="button"
                  class="danger"
                  disabled={revoking}
                  onclick={() => { pendingRevoke = { id: tok.id, label: tok.label }; }}
                >
                  Revoke
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">Recent MCP Activity ({filteredActivity.length})</h3>
        <div class="field activity-search">
          <label class="sr-only" for="mcp-activity-filter">Filter MCP activity</label>
          <input id="mcp-activity-filter" type="search" bind:value={activityFilter} placeholder="Filter tool, actor, state..." />
        </div>
      </div>

      {#if activityError}
        <p class="feedback error" role="alert">{activityError}</p>
      {:else if filteredActivity.length === 0}
        <p class="status-msg">No recent MCP tool activity recorded.</p>
      {:else}
        <div class="table-wrap">
          <table class="data-table" aria-label="Recent MCP tool calls">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Tool</th>
                <th scope="col">State</th>
                <th scope="col">Target</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredActivity as row (row.id)}
                <tr>
                  <td class="nowrap">{formatTimestamp(row.ts)}</td>
                  <td><code>{row.tool}</code></td>
                  <td>
                    <span class="pill" data-tone={row.state === "completed" ? "ok" : row.state === "started" ? "neutral" : "warn"}>
                      {row.state}
                    </span>
                  </td>
                  <td class="wrap-cell">{row.target ?? row.detail ?? "-"}</td>
                  <td class="nowrap">{typeof row.durationMs === "number" ? `${row.durationMs} ms` : "-"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>
