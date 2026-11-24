<script lang="ts">
  import type { Loadable } from "./appdeck-detail";
  import type { BackupRecord } from "./appdeck-schema";
  import { fmtBytes, fmtStamp } from "./appdeck-view";

  let {
    backups,
    busy,
    onload,
    onbackup,
  }: {
    backups: Loadable<BackupRecord[]>;
    busy: string | null;
    onload: () => void;
    onbackup: () => void;
  } = $props();

  let reasonLabel: Record<string, string> = {
    manual: "Manual", "pre-update": "Before update", "pre-uninstall": "Before uninstall",
    "pre-restore": "Before restore", unknown: "Other",
  };
</script>

<div class="pane">
  <div class="block-head">
    <h4>Backups</h4>
    <div class="row">
      <button disabled={backups.kind === "loading"} onclick={onload}>
        {backups.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
      <button class="primary" disabled={busy !== null} onclick={onbackup}>
        {busy === "action:backup" ? "Starting..." : "Create backup"}
      </button>
    </div>
  </div>
  <p class="hint">
    Snapshots live on this host. MSO keeps the newest three per app and prunes older ones automatically.
  </p>
  {#if backups.kind === "idle" || backups.kind === "loading"}
    <p class="hint">Reading saved snapshots...</p>
  {:else if backups.kind === "error"}
    <p class="feedback error" role="alert">{backups.message}</p>
  {:else if backups.data.length === 0}
    <p class="hint">No backups yet. Create one before an update if you want a rollback point.</p>
  {:else}
    <ul class="backups">
      {#each backups.data as backup (backup.id)}
        <li>
          <div class="backup-head">
            <code>{backup.id}</code>
            <span class="pill">{reasonLabel[backup.reason] ?? backup.reason}</span>
          </div>
          <p class="meta">
            {fmtStamp(backup.createdAt)} · {fmtBytes(backup.bytes)}
            {#if backup.files !== null}· {backup.files} files{/if}
          </p>
          {#if backup.source}<p class="meta source">{backup.source}</p>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .pane { display: grid; gap: 0.5rem; min-width: 0; }
  .block-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  h4 { margin: 0; font-size: 0.9375rem; color: var(--text); }
  .row { display: flex; flex-wrap: wrap; gap: 0.375rem; }
  button {
    min-height: 2rem; padding: 0 0.75rem; border: 1px solid var(--border); border-radius: 0.375rem;
    background: var(--panel-solid); color: var(--text); font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .hint { margin: 0; font-size: 0.875rem; color: var(--muted); overflow-wrap: anywhere; }
  .backups { list-style: none; display: grid; gap: 0.5rem; margin: 0.25rem 0 0; padding: 0; }
  .backups li {
    display: grid; gap: 0.125rem; min-width: 0; padding: 0.625rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .backup-head { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .backup-head code { font-size: 0.8125rem; color: var(--text); overflow-wrap: anywhere; }
  .pill {
    padding: 0.0625rem 0.4375rem; border: 1px solid var(--border); border-radius: 999px;
    font-size: 0.6875rem; color: var(--muted);
  }
  .meta { margin: 0; font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .source { font-family: var(--font-mono); }
</style>
