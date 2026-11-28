<script lang="ts">
  import "./BrowserBackupCard.css";
  import { isDemoMode } from "../demo/demo-adapter.ts";
  import { getShellStorage } from "../shell/shell-prefs-store.ts";
  import { describeSkipped } from "./browser-backup.ts";
  import { createBrowserBackupFlow } from "./browser-backup-flow.ts";

  // Informational only: the import never gates on the version that wrote a file,
  // so a rebuild must not invalidate a backup.
  const APP_VERSION = typeof __MSO_BUILD_SHA__ === "string" ? __MSO_BUILD_SHA__ : "unknown";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  const demo = isDemoMode();
  let isOwner = $derived(role === "owner");

  let fileInput: HTMLInputElement | undefined = $state();
  let version = $state(0);
  let busy = $state(false);

  // One guard, shared with the shell store: the property GETTER throws when site
  // data is blocked, so a bare typeof check is not enough.
  const flow = createBrowserBackupFlow({
    storage: () => getShellStorage(),
    reload: () => window.location.reload(),
    appVersion: APP_VERSION,
  });
  // The flow owns the state; `version` is what makes Svelte re-read it.
  let view = $derived.by(() => { void version; return flow.snapshot(); });
  const bump = () => { version += 1; };

  function doExport() {
    flow.setError(null);
    flow.setNotice(null);
    const res = flow.exportBackup();
    bump();
    if (!res.ok) {
      flow.setError(res.error);
      bump();
      return;
    }
    const url = URL.createObjectURL(new Blob([res.json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = res.filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on the next tick, not immediately: a synchronous revoke is what
    // made this download silently do nothing in Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    flow.setNotice(`Saved ${res.count} ${res.count === 1 ? "preference" : "preferences"} to your Downloads folder.`
      + (res.excluded.length > 0 ? ` ${res.excluded.length} stored value was unreadable and left out.` : ""));
    bump();
  }

  async function onFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Clear immediately: re-picking the same path fires no change event otherwise.
    input.value = "";
    if (!file) return;
    busy = true;
    try {
      flow.openFile(file.name, await file.text());
    } catch {
      flow.setError("That file could not be read.");
    } finally {
      busy = false;
      bump();
    }
  }

  function confirmImport() {
    flow.confirm();
    bump();
  }

  function cancelImport() {
    flow.cancel();
    bump();
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

    {#if view.notice}<p class="feedback ok" role="status">{view.notice}</p>{/if}
    {#if view.error}<p class="feedback error" role="alert">{view.error}</p>{/if}

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

    {#if view.pending}
      {@const summary = describeSkipped(view.pending.skipped)}
      <div class="confirm-box" role="alert">
        <p>
          {view.pending.file} holds {view.pending.accepted.length}
          {view.pending.accepted.length === 1 ? "preference" : "preferences"} from MSO {view.pending.blob.appVersion},
          saved {new Date(view.pending.blob.exportedAt).toLocaleString()}.
          Your current browser preferences are REPLACED, and MSO reloads. Files on disk and server
          settings are untouched.
        </p>
        {#if summary.total > 0}
          <p class="meta-line">
            Not restored ({summary.total}):
            {summary.unknown > 0 ? `${summary.unknown} unknown to this build` : ""}
            {summary.invalid > 0 ? `${summary.unknown > 0 ? ", " : ""}${summary.invalid} with unusable values` : ""}
            {summary.security > 0 ? `${summary.unknown + summary.invalid > 0 ? ", " : ""}${summary.security} blocked for security` : ""}.
            Older backups may also list Playbooks, Agents, Automations or window layouts; this build has
            no reader for those, so they are not restored.
          </p>
        {/if}
        <div class="action-row">
          <button type="button" class="danger" onclick={confirmImport}>Replace and reload</button>
          <button type="button" onclick={cancelImport}>Cancel</button>
        </div>
      </div>
    {/if}
  </div>
{/if}
