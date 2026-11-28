<script lang="ts">
  import "./SystemSection.css";
  import BrowserBackupCard from "./BrowserBackupCard.svelte";
  import {
    ApiError,
    formatBytes,
    formatTimestamp,
    readCleanupPreview,
    readFederationStatus,
    readUpdateAutomation,
    runCleanupSelection,
    saveUpdateAutomation,
    type CleanupPreview,
    type FederationStatus,
    type UpdateAutomationView,
  } from "./settings-extra-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let isOwner = $derived(role === "owner");
  let loading = $state(true);

  // Storage cleanup state
  let cleanup = $state<CleanupPreview | null>(null);
  let cleanupError = $state<string | null>(null);
  let cleanupBusy = $state<"scan" | "clean" | null>(null);
  let selectedIds = $state<string[]>([]);
  let confirmingCleanup = $state(false);
  let lastFreedBytes = $state<number | null>(null);
  let cleanupNotice = $state<string | null>(null);

  // Federation worker status
  let federation = $state<FederationStatus | null>(null);
  let federationError = $state<string | null>(null);

  // Update automation state
  let automation = $state<UpdateAutomationView | null>(null);
  let automationError = $state<string | null>(null);
  let automationBusy = $state(false);

  let abortCtrl: AbortController | undefined;

  let selectedItems = $derived(
    (cleanup?.items ?? []).filter((item) => selectedIds.includes(item.id) && item.available),
  );
  let selectedBytes = $derived(selectedItems.reduce((sum, item) => sum + item.bytes, 0));

  function formatError(err: unknown, fallback: string): string {
    return err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback;
  }

  async function refreshAll() {
    if (!isOwner) return;
    abortCtrl?.abort();
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    loading = true;
    cleanupError = null;
    federationError = null;
    automationError = null;
    const [cleanupRes, fedRes, autoRes] = await Promise.all([
      readCleanupPreview(ctrl.signal).catch((err) => {
        if (!ctrl.signal.aborted) cleanupError = formatError(err, "Could not load storage cleanup preview.");
        return null;
      }),
      readFederationStatus(ctrl.signal).catch((err) => {
        if (!ctrl.signal.aborted) federationError = formatError(err, "Could not load federation worker status.");
        return null;
      }),
      readUpdateAutomation(ctrl.signal).catch((err) => {
        if (!ctrl.signal.aborted) automationError = formatError(err, "Could not load update automation state.");
        return null;
      }),
    ]);
    if (ctrl.signal.aborted) return;
    cleanup = cleanupRes;
    selectedIds = [];
    confirmingCleanup = false;
    federation = fedRes;
    automation = autoRes;
    loading = false;
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

  function toggleCategory(id: string, checked: boolean) {
    confirmingCleanup = false;
    if (checked) {
      if (!selectedIds.includes(id)) selectedIds = [...selectedIds, id];
    } else {
      selectedIds = selectedIds.filter((item) => item !== id);
    }
  }

  async function handleRescanCleanup() {
    if (!isOwner || cleanupBusy) return;
    cleanupBusy = "scan";
    cleanupError = null;
    confirmingCleanup = false;
    try {
      cleanup = await readCleanupPreview(new AbortController().signal);
      selectedIds = [];
    } catch (err) {
      cleanupError = formatError(err, "Could not scan cleanup categories.");
    } finally {
      cleanupBusy = null;
    }
  }

  async function handleRunCleanup() {
    if (!isOwner || !cleanup || selectedItems.length === 0 || cleanupBusy) return;
    confirmingCleanup = false;
    cleanupBusy = "clean";
    cleanupError = null;
    cleanupNotice = null;
    try {
      const results = await runCleanupSelection(
        cleanup.previewId,
        selectedItems.map((item) => item.id),
        new AbortController().signal,
      );
      const freed = results.reduce((sum, r) => sum + r.freedBytes, 0);
      lastFreedBytes = freed;
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        cleanupError = `Some categories did not complete: ${failed.map((r) => r.id).join(", ")}.`;
      } else {
        cleanupNotice = `Cleanup completed. Reclaimed ${formatBytes(freed)}.`;
      }
      cleanup = await readCleanupPreview(new AbortController().signal);
      selectedIds = [];
    } catch (err) {
      cleanupError = formatError(err, "Storage cleanup failed.");
    } finally {
      cleanupBusy = null;
    }
  }

  async function handleUpdateAutomation(patch: { auto?: boolean; channel?: "stable" | "main" }) {
    if (!isOwner || automationBusy) return;
    automationBusy = true;
    automationError = null;
    try {
      automation = await saveUpdateAutomation(patch, new AbortController().signal);
    } catch (err) {
      automationError = formatError(err, "Could not update automatic update settings.");
      automation = await readUpdateAutomation(new AbortController().signal).catch(() => automation);
    } finally {
      automationBusy = false;
    }
  }
</script>

<div class="system-section" data-system-settings-state={!isOwner ? "owner-only" : loading ? "loading" : "ready"}>
  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to run storage cleanup, inspect federation workers, and configure nightly update automation.
    </p>
  {:else if loading}
    <p class="status-msg" role="status">Loading system maintenance status...</p>
  {:else}
    <BrowserBackupCard {role} />
    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">Storage Cleanup</h3>
        <button type="button" disabled={cleanupBusy !== null} onclick={() => void handleRescanCleanup()}>
          {cleanupBusy === "scan" ? "Scanning..." : "Rescan"}
        </button>
      </div>
      <p class="status-msg">
        Nothing is selected automatically. Session records, memories, evidence, and volumes are protected and never deleted.
      </p>

      {#if cleanupNotice}<p class="feedback ok" role="status">{cleanupNotice}</p>{/if}
      {#if cleanupError}<p class="feedback error" role="alert">{cleanupError}</p>{/if}

      {#if cleanup}
        <ul class="item-list" aria-label="Cleanup categories">
          {#each cleanup.items as item (item.id)}
            <li class="item-row">
              <label class="cleanup-label" for={`cleanup-${item.id}`}>
                <input
                  id={`cleanup-${item.id}`}
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  disabled={!item.available || cleanupBusy !== null}
                  onchange={(e) => toggleCategory(item.id, (e.currentTarget as HTMLInputElement).checked)}
                />
                <span class="item-copy">
                  <strong>{item.label}</strong>
                  <span class="meta-line">{item.desc}</span>
                </span>
              </label>
              <span class="size-tag">
                {item.available ? formatBytes(item.bytes) : "Protected / unavailable"}
              </span>
            </li>
          {/each}
        </ul>

        {#if cleanup.protectedTargets.length > 0}
          <p class="meta-line">Preserved targets: {cleanup.protectedTargets.join(", ")}.</p>
        {/if}

        {#if lastFreedBytes !== null}
          <p class="meta-line">Last cleanup freed: {formatBytes(lastFreedBytes)}.</p>
        {/if}

        {#if confirmingCleanup}
          <div class="confirm-box" role="alert">
            <p>
              Run cleanup on {selectedItems.length} selected categor{selectedItems.length === 1 ? "y" : "ies"}
              (up to {formatBytes(selectedBytes)})? Trash and vacuumed logs cannot be undone.
            </p>
            <div class="action-row">
              <button type="button" class="danger" disabled={cleanupBusy !== null} onclick={() => void handleRunCleanup()}>
                {cleanupBusy === "clean" ? "Cleaning..." : "Confirm cleanup"}
              </button>
              <button type="button" disabled={cleanupBusy !== null} onclick={() => { confirmingCleanup = false; }}>
                Cancel
              </button>
            </div>
          </div>
        {:else}
          <div class="action-row">
            <button
              type="button"
              class="primary"
              disabled={selectedItems.length === 0 || cleanupBusy !== null}
              onclick={() => { confirmingCleanup = true; }}
            >
              {selectedItems.length > 0
                ? `Review cleanup (${selectedItems.length} selected, ${formatBytes(selectedBytes)})`
                : "Select categories to clean"}
            </button>
          </div>
        {/if}
      {/if}
    </div>

    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">Nightly Update Automation</h3>
        {#if automation}
          <span class="pill" data-tone={automation.active ? "ok" : "neutral"}>
            {automation.active ? "Scheduled" : "Off"}
          </span>
        {/if}
      </div>

      {#if automationError}
        <p class="feedback error" role="alert">{automationError}</p>
      {/if}

      {#if automation}
        <div class="toggle-list">
          <label class="toggle-row" for="sys-auto-update">
            <span>Update automatically at night (04:30 to 04:55)</span>
            <input
              id="sys-auto-update"
              type="checkbox"
              checked={automation.active}
              disabled={automationBusy || !automation.supported}
              onchange={(e) => void handleUpdateAutomation({ auto: (e.currentTarget as HTMLInputElement).checked })}
            />
          </label>
        </div>

        <div class="field">
          <label for="sys-update-channel">Update channel</label>
          <select
            id="sys-update-channel"
            value={automation.prefs.channel}
            disabled={automationBusy || !automation.supported}
            onchange={(e) => void handleUpdateAutomation({
              channel: (e.currentTarget as HTMLSelectElement).value === "main" ? "main" : "stable",
            })}
          >
            <option value="stable">Stable releases</option>
            <option value="main">Rolling main</option>
          </select>
        </div>

        <dl class="metric-grid">
          <div class="metric-box">
            <dt>Nightly timer</dt>
            <dd>
              {automation.active
                ? (automation.timer.nextRun ? `Next: ${automation.timer.nextRun}` : "Enabled")
                : automation.timer.installed ? "Installed (disabled)" : "Not installed"}
            </dd>
          </div>
          <div class="metric-box">
            <dt>Last attempt</dt>
            <dd>
              {automation.last.lastResult
                ? `${automation.last.lastResult} (${formatTimestamp(automation.last.lastAttemptAt)})`
                : "No runs recorded"}
            </dd>
          </div>
        </dl>

        {#if !automation.supported && automation.reason}
          <p class="feedback pending" role="status">Unavailable on this host: {automation.reason}</p>
        {/if}
        {#if automation.drift}
          <p class="feedback pending" role="alert">{automation.drift}</p>
        {/if}
        {#if automation.last.detail}
          <p class="meta-line">Last detail: {automation.last.detail}</p>
        {/if}
      {/if}
    </div>

    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">Federation Worker Status</h3>
        <div class="badge-row">
          {#if federation}
            <span class="pill" data-tone={federation.connected ? "ok" : federation.running ? "warn" : "neutral"}>
              {federation.connected ? "Connected" : federation.running ? "Running (disconnected)" : "Stopped"}
            </span>
          {/if}
          <button type="button" onclick={() => void refreshAll()}>Refresh</button>
        </div>
      </div>

      {#if federationError}
        <p class="feedback error" role="alert">{federationError}</p>
      {:else if federation}
        <dl class="metric-grid">
          <div class="metric-box">
            <dt>MSO tools</dt>
            <dd>{federation.msoToolCount}</dd>
          </div>
          <div class="metric-box">
            <dt>Last outcome</dt>
            <dd>{federation.lastOutcome ?? "idle"}</dd>
          </div>
          <div class="metric-box">
            <dt>Consecutive failures</dt>
            <dd>{federation.consecutiveFailures}</dd>
          </div>
          <div class="metric-box">
            <dt>Last poll</dt>
            <dd>{formatTimestamp(federation.lastPollAt)}</dd>
          </div>
          {#if federation.batonProject}
            <div class="metric-box">
              <dt>Baton project</dt>
              <dd><code>{federation.batonProject}</code></dd>
            </div>
          {/if}
          {#if federation.siCoderVersion}
            <div class="metric-box">
              <dt>si-coder runtime</dt>
              <dd>{federation.siCoderVersion} ({federation.siCoderFunctionCount ?? 0} fns)</dd>
            </div>
          {/if}
        </dl>
        {#if federation.lastError}
          <p class="feedback error" role="alert">Last federation error: {federation.lastError}</p>
        {/if}
      {/if}
    </div>
  {/if}
</div>
