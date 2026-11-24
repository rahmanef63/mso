<script lang="ts">
  import "./MemorySection.css";
  import {
    addMemoryFact,
    ApiError,
    createMemoryBackupSnapshot,
    deleteMemoryFact,
    formatBytes,
    formatTimestamp,
    readMemories,
    readMemoryBackupHistory,
    readMemoryBackupPreview,
    verifyMemoryBackupSnapshot,
    type MemoryBackupHistoryEntry,
    type MemoryBackupScan,
    type MemoryBackupSummary,
    type MemoryBackupVerification,
    type MemoryFact,
  } from "./settings-extra-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let isOwner = $derived(role === "owner");
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  // Alfa cross-session memory facts
  let memories = $state<MemoryFact[]>([]);
  let newFact = $state("");
  let savingFact = $state(false);
  let confirmDeleteId = $state<string | null>(null);

  // Server memory backup state
  let backupScan = $state<MemoryBackupScan | null>(null);
  let backupHistory = $state<MemoryBackupHistoryEntry[]>([]);
  let backupError = $state<string | null>(null);
  let backupBusy = $state<"scan" | "create" | "verify" | null>(null);
  let confirmCreateBackup = $state(false);
  let latestSnapshot = $state<MemoryBackupSummary | null>(null);
  let verification = $state<MemoryBackupVerification | null>(null);

  let notice = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let abortCtrl: AbortController | undefined;

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
    backupError = null;
    try {
      const [factsRes, scanRes, histRes] = await Promise.all([
        readMemories(ctrl.signal),
        readMemoryBackupPreview(ctrl.signal).catch((err) => {
          backupError = formatError(err, "Could not preview server memory backup.");
          return null;
        }),
        readMemoryBackupHistory(ctrl.signal).catch(() => ({ items: [] as MemoryBackupHistoryEntry[], nextOffset: null })),
      ]);
      if (ctrl.signal.aborted) return;
      memories = factsRes;
      backupScan = scanRes;
      backupHistory = histRes.items;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      loadError = formatError(err, "Could not load memory settings.");
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

  async function handleAddFact(event: SubmitEvent) {
    event.preventDefault();
    const clean = newFact.trim();
    if (!isOwner || !clean || savingFact) return;
    savingFact = true;
    notice = null;
    actionError = null;
    try {
      await addMemoryFact(clean, new AbortController().signal);
      newFact = "";
      notice = "Memory fact saved.";
      await refreshAll();
    } catch (err) {
      actionError = formatError(err, "Could not save memory fact.");
    } finally {
      savingFact = false;
    }
  }

  async function handleDeleteFact(id: string) {
    if (!isOwner || savingFact) return;
    savingFact = true;
    confirmDeleteId = null;
    notice = null;
    actionError = null;
    try {
      await deleteMemoryFact(id, new AbortController().signal);
      notice = "Memory fact removed.";
      await refreshAll();
    } catch (err) {
      actionError = formatError(err, "Could not delete memory fact.");
    } finally {
      savingFact = false;
    }
  }

  async function handleRescanBackup() {
    if (!isOwner || backupBusy) return;
    backupBusy = "scan";
    backupError = null;
    try {
      const [scan, hist] = await Promise.all([
        readMemoryBackupPreview(new AbortController().signal),
        readMemoryBackupHistory(new AbortController().signal),
      ]);
      backupScan = scan;
      backupHistory = hist.items;
    } catch (err) {
      backupError = formatError(err, "Could not scan memory backup sources.");
    } finally {
      backupBusy = null;
    }
  }

  async function handleCreateBackup() {
    if (!isOwner || backupBusy) return;
    confirmCreateBackup = false;
    backupBusy = "create";
    backupError = null;
    verification = null;
    notice = null;
    try {
      const snap = await createMemoryBackupSnapshot(new AbortController().signal);
      latestSnapshot = snap;
      notice = `Created memory backup snapshot ${snap.id} (${formatBytes(snap.compressedBytes)}).`;
      await handleRescanBackup();
    } catch (err) {
      backupError = formatError(err, "Could not create memory backup snapshot.");
    } finally {
      backupBusy = null;
    }
  }

  async function handleVerifyBackup(id: string, manifestSha256: string) {
    if (!isOwner || backupBusy) return;
    backupBusy = "verify";
    backupError = null;
    verification = null;
    try {
      verification = await verifyMemoryBackupSnapshot(id, manifestSha256, new AbortController().signal);
      await handleRescanBackup();
    } catch (err) {
      backupError = formatError(err, "Could not verify memory backup snapshot.");
    } finally {
      backupBusy = null;
    }
  }
</script>

<div class="memory-section" data-memory-settings-state={!isOwner ? "owner-only" : loading ? "loading" : loadError ? "error" : "ready"}>
  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect saved Alfa memories and manage server memory backups.
    </p>
  {:else if loading}
    <p class="status-msg" role="status">Loading memory facts and backup snapshots...</p>
  {:else if loadError}
    <div class="feedback error" role="alert">
      <p>{loadError}</p>
      <button type="button" onclick={() => void refreshAll()}>Retry</button>
    </div>
  {:else}
    {#if notice}<p class="feedback ok" role="status">{notice}</p>{/if}
    {#if actionError}<p class="feedback error" role="alert">{actionError}</p>{/if}

    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">Alfa Memory Facts ({memories.length})</h3>
        <button type="button" onclick={() => void refreshAll()}>Refresh</button>
      </div>
      <p class="status-msg">
        Cross-session facts recalled into Alfa prompts when relevant. Stored server-side.
      </p>

      <form class="add-row" onsubmit={(e) => void handleAddFact(e)} novalidate>
        <div class="field fact-input">
          <label class="sr-only" for="memory-fact-input">New memory fact</label>
          <input
            id="memory-fact-input"
            type="text"
            bind:value={newFact}
            disabled={savingFact}
            placeholder="Remember a fact (e.g. Deploy with bun run build)"
          />
        </div>
        <button type="submit" class="primary" disabled={savingFact || !newFact.trim()}>
          {savingFact ? "Saving..." : "Add fact"}
        </button>
      </form>

      {#if memories.length === 0}
        <p class="status-msg">No saved memory facts yet.</p>
      {:else}
        <ul class="item-list" aria-label="Saved memory facts">
          {#each memories as fact (fact.id)}
            <li class="item-row">
              <div class="item-copy">
                <span class="fact-text">{fact.text}</span>
                <span class="meta-line">Saved {formatTimestamp(fact.createdAt)}</span>
              </div>
              <div class="item-actions">
                {#if confirmDeleteId === fact.id}
                  <button type="button" class="danger" disabled={savingFact} onclick={() => void handleDeleteFact(fact.id)}>
                    Confirm delete
                  </button>
                  <button type="button" disabled={savingFact} onclick={() => { confirmDeleteId = null; }}>
                    Cancel
                  </button>
                {:else}
                  <button type="button" disabled={savingFact} onclick={() => { confirmDeleteId = fact.id; }}>
                    Delete
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="settings-card">
      <div class="card-head-row">
        <h3 class="card-heading">Server Memory Backup &amp; Restore Verification</h3>
        <button type="button" disabled={backupBusy !== null} onclick={() => void handleRescanBackup()}>
          {backupBusy === "scan" ? "Scanning..." : "Rescan"}
        </button>
      </div>
      <p class="status-msg">
        Creates verified local archives of server memory stores. Verification restores into an isolated temp directory with zero writes to live sources.
      </p>

      {#if backupError}
        <p class="feedback error" role="alert">{backupError}</p>
      {/if}

      {#if backupScan}
        <dl class="metric-grid">
          <div class="metric-box">
            <dt>Files</dt>
            <dd>{backupScan.files}</dd>
          </div>
          <div class="metric-box">
            <dt>Total size</dt>
            <dd>{formatBytes(backupScan.bytes)}</dd>
          </div>
          <div class="metric-box">
            <dt>Excluded / Missing</dt>
            <dd>{backupScan.excluded} / {backupScan.missing}</dd>
          </div>
          <div class="metric-box">
            <dt>Rejected</dt>
            <dd>{backupScan.rejected}{backupScan.truncated ? " (truncated)" : ""}</dd>
          </div>
        </dl>
      {/if}

      {#if confirmCreateBackup}
        <div class="confirm-box" role="alert">
          <p>Create a new server memory backup snapshot now? Live memory files are read-only during backup.</p>
          <div class="action-row">
            <button type="button" class="primary" disabled={backupBusy !== null} onclick={() => void handleCreateBackup()}>
              {backupBusy === "create" ? "Creating..." : "Confirm create snapshot"}
            </button>
            <button type="button" disabled={backupBusy !== null} onclick={() => { confirmCreateBackup = false; }}>
              Cancel
            </button>
          </div>
        </div>
      {:else}
        <div class="action-row">
          <button
            type="button"
            class="primary"
            disabled={backupBusy !== null || !backupScan}
            onclick={() => { confirmCreateBackup = true; }}
          >
            {backupBusy === "create" ? "Creating snapshot..." : "Create backup snapshot"}
          </button>
        </div>
      {/if}

      {#if latestSnapshot}
        <div class="result-card">
          <p class="result-title">Latest snapshot: <code>{latestSnapshot.id}</code></p>
          <p class="meta-line">
            State: {latestSnapshot.state} | Size: {formatBytes(latestSnapshot.compressedBytes)} | Manifest: <code>{latestSnapshot.manifestSha256.slice(0, 16)}</code>
          </p>
          <p class="meta-line">Directory: <code>{latestSnapshot.directory}</code></p>
          <div class="action-row">
            <button
              type="button"
              disabled={backupBusy !== null}
              onclick={() => void handleVerifyBackup(latestSnapshot!.id, latestSnapshot!.manifestSha256)}
            >
              {backupBusy === "verify" ? "Verifying..." : "Verify restore"}
            </button>
          </div>
        </div>
      {/if}

      {#if verification}
        <div class="feedback" class:ok={verification.integrity} class:error={!verification.integrity} role="status">
          <p>
            Verification for <code>{verification.id}</code>: {verification.integrity ? "Integrity passed" : "Integrity failed"}
            ({verification.restoredFiles} files restored, source writes: {verification.sourceWritesPerformed}).
          </p>
          {#if verification.restoreDirectory}
            <p class="meta-line">Isolated restore path: <code>{verification.restoreDirectory}</code></p>
          {/if}
        </div>
      {/if}

      <div class="history-block">
        <h4 class="sub-heading">Saved Snapshots ({backupHistory.length})</h4>
        {#if backupHistory.length === 0}
          <p class="status-msg">No saved backup snapshots found yet.</p>
        {:else}
          <ul class="item-list">
            {#each backupHistory as entry (entry.id)}
              <li class="item-row">
                {#if entry.status === "readable"}
                  <div class="item-copy">
                    <div class="badge-row">
                      <code>{entry.snapshot.id}</code>
                      <span class="pill" data-tone={entry.integrity === "verified-at-recorded-time" ? "ok" : entry.integrity === "receipt-invalid" ? "warn" : "neutral"}>
                        {entry.integrity}
                      </span>
                    </div>
                    <span class="meta-line">
                      {formatTimestamp(entry.snapshot.createdAt)} | {entry.snapshot.scan.files} files | {formatBytes(entry.snapshot.compressedBytes)}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={backupBusy !== null}
                    onclick={() => void handleVerifyBackup(entry.snapshot.id, entry.snapshot.manifestSha256)}
                  >
                    {backupBusy === "verify" ? "Verifying..." : "Verify restore"}
                  </button>
                {:else}
                  <div class="item-copy">
                    <code>{entry.id}</code>
                    <span class="meta-line">Unreadable snapshot ({entry.error})</span>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</div>
