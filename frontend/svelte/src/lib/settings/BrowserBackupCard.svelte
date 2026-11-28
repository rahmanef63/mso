<script lang="ts">
  import "./BrowserBackupCard.css";
  import { isDemoMode } from "../demo/demo-adapter.ts";
  import { getShellStorage } from "../shell/shell-prefs-store.ts";
  import {
    backupFilename,
    collectBrowserPrefs,
    describeSkipped,
    parseBrowserBackup,
    restoreBrowserPrefs,
    type BrowserPrefsBlob,
    type SkippedKey,
  } from "./browser-backup.ts";

  // Informational only: the import never gates on the version that wrote a file,
  // so a rebuild must not invalidate a backup.
  const APP_VERSION = typeof __MSO_BUILD_SHA__ === "string" ? __MSO_BUILD_SHA__ : "unknown";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  const demo = isDemoMode();
  let isOwner = $derived(role === "owner");

  let fileInput: HTMLInputElement | undefined = $state();
  let pending = $state<{ file: string; blob: BrowserPrefsBlob; accepted: string[]; skipped: SkippedKey[] } | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state(false);

  let skippedSummary = $derived(pending ? describeSkipped(pending.skipped) : null);

  // One guard, shared with the shell store: the property GETTER throws when site
  // data is blocked, so a bare typeof check is not enough.
  const storage = () => getShellStorage();

  function doExport() {
    error = null;
    notice = null;
    const probe = storage();
    if (!probe) {
      error = "This browser does not allow local storage, so there is nothing to export.";
      return;
    }
    const { blob, excluded } = collectBrowserPrefs(probe, APP_VERSION);
    const count = Object.keys(blob.keys).length;
    if (count === 0) {
      error = "This browser holds none of the preferences MSO can back up yet.";
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = backupFilename();
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on the next tick, not immediately: a synchronous revoke is what
    // made this download silently do nothing in Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    notice = `Saved ${count} ${count === 1 ? "preference" : "preferences"} to your Downloads folder.`
      + (excluded.length > 0 ? ` ${excluded.length} stored value was unreadable and left out.` : "");
  }

  async function onFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Clear immediately: re-picking the same path fires no change event otherwise.
    input.value = "";
    if (!file) return;
    error = null;
    notice = null;
    busy = true;
    try {
      const text = await file.text();
      const res = parseBrowserBackup(text);
      if (!res.ok) {
        error = res.error;
        return;
      }
      if (res.accepted.length === 0) {
        error = "Nothing in that file can be restored by this build.";
        return;
      }
      pending = { file: file.name, blob: res.blob, accepted: res.accepted, skipped: res.skipped };
    } catch {
      error = "That file could not be read.";
    } finally {
      busy = false;
    }
  }

  function confirmImport() {
    if (!pending) return;
    // Nothing below reloads unless the write actually landed.
    const res = restoreBrowserPrefs(pending.blob, storage());
    if (!res.ok) {
      error = res.error + (res.rolledBack ? "" : " Some values may not have been restored.");
      pending = null;
      return;
    }
    pending = null;
    notice = `Restored ${res.restored.length} ${res.restored.length === 1 ? "preference" : "preferences"}. Reloading…`;
    // A full reload, not a state refresh: the shell reads storage once at module
    // init, so anything less leaves the cockpit on the pre-import values.
    window.location.reload();
  }
</script>

{#if isOwner && !demo}
  <div class="settings-card" data-slot="browser-backup">
    <div class="card-head-row">
      <h3 class="card-heading">Browser backup</h3>
    </div>
    <p class="status-msg">
      Covers the preferences that live only in this browser: the shell choice (macOS, Windows, iOS,
      Android or Dashboard), accent colour, bold text, and text size. Nothing here leaves the device,
      and the approved-device identity is deliberately left out so a leaked file cannot skip device approval.
    </p>

    {#if notice}<p class="feedback ok" role="status">{notice}</p>{/if}
    {#if error}<p class="feedback error" role="alert">{error}</p>{/if}

    <div class="action-row">
      <button type="button" class="primary" onclick={doExport}>Export browser backup</button>
      <button type="button" disabled={busy} onclick={() => fileInput?.click()}>
        {busy ? "Reading…" : "Import browser backup"}
      </button>
    </div>

    <input
      bind:this={fileInput}
      type="file"
      accept="application/json,.json"
      onchange={onFile}
      hidden
      tabindex="-1"
      aria-hidden="true"
    />

    {#if pending && skippedSummary}
      <div class="confirm-box" role="alert">
        <p>
          {pending.file} holds {pending.accepted.length}
          {pending.accepted.length === 1 ? "preference" : "preferences"} from MSO {pending.blob.appVersion},
          saved {new Date(pending.blob.exportedAt).toLocaleString()}.
          Your current browser preferences are REPLACED, and MSO reloads. Files on disk and server
          settings are untouched.
        </p>
        {#if skippedSummary.total > 0}
          <p class="meta-line">
            Not restored ({skippedSummary.total}):
            {skippedSummary.unknown > 0 ? `${skippedSummary.unknown} unknown to this build` : ""}
            {skippedSummary.invalid > 0 ? `${skippedSummary.unknown > 0 ? ", " : ""}${skippedSummary.invalid} with unusable values` : ""}
            {skippedSummary.security > 0 ? `${skippedSummary.unknown + skippedSummary.invalid > 0 ? ", " : ""}${skippedSummary.security} blocked for security` : ""}.
            Older backups may also list Playbooks, Agents, Automations or window layouts; this build has
            no reader for those, so they are not restored.
          </p>
        {/if}
        <div class="action-row">
          <button type="button" class="danger" onclick={confirmImport}>Replace and reload</button>
          <button type="button" onclick={() => { pending = null; }}>Cancel</button>
        </div>
      </div>
    {/if}
  </div>
{/if}
