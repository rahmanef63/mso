<script lang="ts">
  import type { Loadable } from "./appdeck-detail";
  import type { PreflightReport, UpdateStatus } from "./appdeck-schema";
  import { fmtStamp } from "./appdeck-view";

  let {
    appName,
    installed,
    running,
    preflight,
    update,
    busy,
    onpreflight,
    onaction,
    oninstall,
    onupdate,
    onuninstall,
  }: {
    appName: string;
    installed: boolean;
    running: boolean;
    preflight: Loadable<PreflightReport>;
    update: Loadable<UpdateStatus>;
    busy: string | null;
    onpreflight: () => void;
    onaction: (action: "start" | "stop" | "restart" | "backup") => void;
    oninstall: () => void;
    onupdate: () => void;
    onuninstall: () => void;
  } = $props();

  let pending = $state<"stop" | "uninstall" | null>(null);

  function askStop() { pending = "stop"; }
  function askUninstall() { pending = "uninstall"; }
  function cancel() { pending = null; }
  function confirm() {
    const action = pending;
    pending = null;
    if (action === "stop") onaction("stop");
    if (action === "uninstall") onuninstall();
  }

  let updateLabel = $derived.by(() => {
    if (update.kind !== "ready") return null;
    const status = update.data;
    if (status.updateAvailable === true) return status.latestVersion ? `Version ${status.latestVersion} available` : "Update available";
    if (status.updateAvailable === false) return "Up to date";
    return status.error ? "Update state unknown" : "Update not checked yet";
  });
</script>

<div class="pane">
  <section aria-labelledby="preflight-heading" class="block">
    <div class="block-head">
      <h4 id="preflight-heading">Preflight</h4>
      <button disabled={preflight.kind === "loading"} onclick={onpreflight}>
        {preflight.kind === "loading" ? "Checking..." : "Run checks"}
      </button>
    </div>
    {#if preflight.kind === "idle"}
      <p class="hint">Run the host checks before installing or updating {appName}.</p>
    {:else if preflight.kind === "loading"}
      <p class="hint">Reading host compatibility, storage, and port state...</p>
    {:else if preflight.kind === "error"}
      <p class="feedback error" role="alert">{preflight.message}</p>
    {:else}
      <p class="hint" role="status">
        {preflight.data.summary}
        <span class="muted">Checked {fmtStamp(preflight.data.checkedAt)}</span>
      </p>
      <ul class="checks">
        {#each preflight.data.checks as check (check.id)}
          <li data-status={check.status}>
            <span class="badge">{check.status}</span>
            <div>
              <strong>{check.label}</strong>
              <p>{check.detail}</p>
              {#if check.fixHint}<p class="fix">{check.fixHint}</p>{/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-labelledby="update-heading" class="block">
    <div class="block-head">
      <h4 id="update-heading">Version and update</h4>
      <button disabled={busy !== null || !installed} onclick={onupdate}>
        {busy === "update" ? "Starting..." : "Update"}
      </button>
    </div>
    {#if updateLabel}
      <p class="hint" role="status">{updateLabel}</p>
    {/if}
    {#if update.kind === "ready"}
      <dl class="facts">
        <div><dt>Current</dt><dd><code>{update.data.currentVersion ?? "unknown"}</code></dd></div>
        <div><dt>Channel</dt><dd>{update.data.channel.value ?? "not reported"}</dd></div>
        {#if update.data.checkedAt}<div><dt>Checked</dt><dd>{fmtStamp(update.data.checkedAt)}</dd></div>{/if}
      </dl>
      {#if update.data.detail}<p class="detail">{update.data.detail}</p>{/if}
      {#if update.data.error}<p class="feedback error" role="alert">{update.data.error}</p>{/if}
    {:else if update.kind === "error"}
      <p class="feedback error" role="alert">{update.message}</p>
    {/if}
  </section>

  <section aria-labelledby="lifecycle-heading" class="block">
    <h4 id="lifecycle-heading">Lifecycle</h4>
    {#if pending}
      <div class="confirm" role="group" aria-labelledby="lifecycle-heading">
        <p>
          {pending === "stop"
            ? `Stop ${appName}? Anything using it loses its connection until it starts again.`
            : `Uninstall ${appName}? MSO takes a safety backup first, then removes the runtime.`}
        </p>
        <div class="row">
          <button class="danger" disabled={busy !== null} onclick={confirm}>
            {pending === "stop" ? "Confirm stop" : "Confirm uninstall"}
          </button>
          <button class="ghost" onclick={cancel}>Cancel</button>
        </div>
      </div>
    {:else}
      <div class="row">
        {#if !installed}
          <button class="primary" disabled={busy !== null} onclick={oninstall}>
            {busy === "install" ? "Starting install..." : "Install"}
          </button>
        {:else}
          {#if running}
            <button disabled={busy !== null} onclick={askStop}>Stop</button>
            <button disabled={busy !== null} onclick={() => onaction("restart")}>Restart</button>
          {:else}
            <button class="primary" disabled={busy !== null} onclick={() => onaction("start")}>Start</button>
          {/if}
          <button disabled={busy !== null} onclick={() => onaction("backup")}>Backup now</button>
          <button class="danger" disabled={busy !== null} onclick={askUninstall}>Uninstall</button>
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .pane { display: grid; gap: 1rem; min-width: 0; }
  .block { display: grid; gap: 0.5rem; min-width: 0; padding-top: 0.75rem; border-top: 1px solid var(--border); }
  .block:first-child { border-top: 0; padding-top: 0; }
  .block-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  h4 { margin: 0; font-size: 0.9375rem; color: var(--text); }
  button {
    min-height: 2rem; padding: 0 0.75rem; border: 1px solid var(--border); border-radius: 0.375rem;
    background: var(--panel-solid); color: var(--text); font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  button.danger { border-color: var(--danger); color: var(--danger); background: var(--danger-bg); }
  button.ghost { background: transparent; }
  .row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .hint { margin: 0; font-size: 0.875rem; color: var(--text); overflow-wrap: anywhere; }
  .muted { display: block; font-size: 0.75rem; color: var(--muted); }
  .detail { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .checks { list-style: none; display: grid; gap: 0.5rem; margin: 0; padding: 0; }
  .checks li { display: flex; gap: 0.5rem; align-items: flex-start; min-width: 0; }
  .checks p { margin: 0.125rem 0 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .checks .fix { color: var(--warn); }
  .badge {
    flex: 0 0 auto; padding: 0.0625rem 0.375rem; border: 1px solid var(--border); border-radius: 999px;
    font-size: 0.6875rem; text-transform: uppercase; color: var(--muted);
  }
  .checks li[data-status="pass"] .badge { color: var(--ok); border-color: var(--ok); background: var(--ok-bg); }
  .checks li[data-status="warn"] .badge { color: var(--warn); border-color: var(--warn); background: var(--warn-bg); }
  .checks li[data-status="fail"] .badge { color: var(--danger); border-color: var(--danger); background: var(--danger-bg); }
  .facts { display: flex; flex-wrap: wrap; gap: 0.375rem 1rem; margin: 0; font-size: 0.8125rem; }
  .facts div { display: flex; gap: 0.375rem; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
  .confirm {
    display: grid; gap: 0.5rem; padding: 0.625rem; border: 1px solid var(--danger);
    border-radius: 0.5rem; background: var(--danger-bg);
  }
  .confirm p { margin: 0; font-size: 0.875rem; color: var(--text); }
</style>
