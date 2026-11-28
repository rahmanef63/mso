<script lang="ts">
  import { untrack } from "svelte";
  import { isDemoMode } from "../demo/demo-adapter.ts";
  import {
    createSoftwareUpdateController,
    readSoftwareUpdate,
    finishedSoftwareUpdate,
    requestSoftwareUpdate,
    type SoftwareUpdateState,
    type SoftwareUpdateStatus,
  } from "./host-ops-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<SoftwareUpdateState>({ kind: "loading" });
  let controller: ReturnType<typeof createSoftwareUpdateController> | undefined;

  type UpdateAction = "check" | "update" | "rebuild";
  let busy = $state<UpdateAction | null>(null);
  let confirmAction = $state<"update" | "rebuild" | null>(null);
  let actionError = $state("");
  let result = $state("");
  let actionController: AbortController | undefined;
  const demo = isDemoMode();
  let isOwner = $derived(role === "owner");
  let polling = $derived(isOwner && view.kind === "ready" && view.status.running);

  function canStart(info: SoftwareUpdateStatus) {
    return info.supported && !info.running && !info.dirty && info.ahead === 0
      && info.remoteChecked && info.conflict?.safe !== false;
  }

  async function act(action: UpdateAction) {
    if (demo || !isOwner || busy || polling) return;
    if (action !== "check" && (view.kind !== "ready" || !canStart(view.status)
      || (action === "update" ? view.status.behind === 0 : view.status.behind !== 0))) return;
    const ctrl = new AbortController();
    actionController = ctrl;
    busy = action;
    confirmAction = null;
    actionError = "";
    result = "";
    try {
      const status = await requestSoftwareUpdate(action, ctrl.signal);
      if (!ctrl.signal.aborted) view = { kind: "ready", status };
    } catch (err) {
      if (!ctrl.signal.aborted) actionError = err instanceof Error ? err.message : "Could not reach the host.";
    } finally {
      if (actionController === ctrl) { actionController = undefined; busy = null; }
    }
  }

  // Poll without reaching GitHub, only while the host reports an active job.
  // Bound the loop, tolerate the service restart and never re-submit the POST.
  $effect(() => {
    if (demo || !polling) return;
    const initialLog = untrack(() => view.kind === "ready" ? view.status.log : "");
    const ctrl = new AbortController();
    const deadline = Date.now() + 15 * 60_000;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (ctrl.signal.aborted) return;
      if (Date.now() >= deadline) {
        actionError = "Stopped checking automatically. Refresh status to see whether the update finished.";
        return;
      }
      try {
        const status = await readSoftwareUpdate(ctrl.signal);
        if (ctrl.signal.aborted) return;
        view = { kind: "ready", status };
        if (!status.running) {
          result = finishedSoftwareUpdate(status, initialLog)
            ? "Update finished. The running build matches the checkout."
            : "Update stopped. Check the running build and build log before retrying.";
          return;
        }
      } catch { /* the service can briefly disappear during a restart */ }
      if (!ctrl.signal.aborted) timer = setTimeout(() => void tick(), 3000);
    }
    timer = setTimeout(() => void tick(), 3000);
    return () => { ctrl.abort(); clearTimeout(timer); };
  });

  function statusSummary(info: SoftwareUpdateStatus): { label: string; detail: string; tone: "ok" | "warn" | "neutral" } {
    if (info.running) return { label: "Updating", detail: "An update job is currently running on the host.", tone: "warn" };
    if (!info.supported) return { label: "Unavailable", detail: info.reason ?? "This deployment cannot update itself.", tone: "neutral" };
    if (info.behind > 0) {
      const target = info.latest ? `${info.target ?? "remote"} (${info.latest.slice(0, 8)})` : (info.target ?? "remote");
      return {
        label: "Update available",
        detail: `${info.behind} commit(s) behind ${target}.`,
        tone: "warn",
      };
    }
    if (info.pendingBuild) {
      return {
        label: "Rebuild pending",
        detail: `Running build ${info.buildSha.slice(0, 8)} differs from checkout ${info.current.slice(0, 8)}.`,
        tone: "warn",
      };
    }
    if (info.dirty) return { label: "Checkout dirty", detail: "Uncommitted local changes are present in the checkout.", tone: "warn" };
    if (info.ahead > 0) return { label: "Local commits", detail: `Checkout is ahead by ${info.ahead} commit(s).`, tone: "neutral" };
    return {
      label: "Up to date",
      detail: info.remoteChecked ? "Checkout matches the configured update target." : "No local updates detected; remote check has not run.",
      tone: "ok",
    };
  }

  let summary = $derived(view.kind === "ready" ? statusSummary(view.status) : null);

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.status.running) return "running";
    if (view.status.behind > 0 || view.status.pendingBuild) return "update-available";
    return view.status.supported ? "up-to-date" : "unsupported";
  });

  export function refresh() {
    if (isOwner && !busy) void controller?.refresh();
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      controller = undefined;
      return;
    }
    const next = createSoftwareUpdateController((s) => { view = s; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      actionController?.abort();
      if (controller === next) controller = undefined;
    };
  });
</script>

<section aria-labelledby="software-update-title" aria-busy={isOwner && view.kind === "loading"} data-software-update-state={stateTag}>
  <header class="feature-header">
    <div class="update-title-group">
      <h2 id="software-update-title">Software update</h2>
      {#if isOwner && summary}
        <span class="update-pill" data-tone={summary.tone}>{summary.label}</span>
      {/if}
    </div>
    {#if isOwner}
      <button type="button" disabled={view.kind === "loading" || busy !== null} onclick={refresh}>
        {view.kind === "loading" ? "Checking..." : "Refresh"}
      </button>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect software updates. Sign in from an Owner device to check version status.
    </p>
  {:else}
    {#if actionError}<p class="feedback error" role="alert">{actionError}</p>{/if}
    {#if result}<p role="status">{result}</p>{/if}
    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Checking host software update status...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else if summary}
        <dl class="update-metrics">
          <div class="metric">
            <dt>Current version</dt>
            <dd><code>{view.status.current}</code></dd>
            {#if view.status.currentSubject}
              <p class="metric-note">{view.status.currentSubject}</p>
            {/if}
          </div>
          <div class="metric">
            <dt>Update status</dt>
            <dd>{summary.label}</dd>
            <p class="metric-note">{summary.detail}</p>
          </div>
          <div class="metric">
            <dt>Channel</dt>
            <dd>{view.status.channel ?? "stable"}</dd>
            <p class="metric-note">
              Target: {view.status.target ?? "origin/main"}{#if view.status.targetFallback} (fallback to rolling main){/if}
            </p>
          </div>
        </dl>

        {#if view.status.conflict && !view.status.conflict.safe}
          <p class="feedback pending" role="status">
            Update preflight detected conflicts ({view.status.conflict.conflicted.length} conflicted, {view.status.conflict.overlap.length} overlapping).
          </p>
        {/if}

        {#if !demo}
        <div class="update-actions">
          <button type="button" disabled={busy !== null || polling || !view.status.supported} onclick={() => void act("check")}>
            {busy === "check" ? "Checking..." : "Check for updates"}
          </button>
          {#if canStart(view.status)}
            {#if view.status.behind > 0}
              <button type="button" disabled={busy !== null} onclick={() => { confirmAction = "update"; }}>Update version</button>
            {:else}
              <button type="button" disabled={busy !== null} onclick={() => { confirmAction = "rebuild"; }}>Rebuild and restart</button>
            {/if}
          {/if}
        </div>
        {#if confirmAction && canStart(view.status)}
          <div class="feedback pending">
            <p>{confirmAction === "update" ? "Install the available update" : "Rebuild the current checkout"} and restart MSO?</p>
            <button type="button" disabled={busy !== null} onclick={() => { if (confirmAction) void act(confirmAction); }}>Confirm and restart</button>
            <button type="button" onclick={() => { confirmAction = null; }}>Cancel</button>
          </div>
        {/if}
        {/if}
        {#if view.status.log}
          <details>
            <summary>Build log</summary>
            <pre class="update-log">{view.status.log}</pre>
          </details>
        {/if}

        {#if view.status.commits.length > 0}
          <div class="commits-block">
            <h3>Incoming commits ({view.status.commits.length})</h3>
            <ul class="commits-list" aria-label="Incoming update commits">
              {#each view.status.commits as commit (commit.sha)}
                <li class="commit-row">
                  <code>{commit.sha.slice(0, 8)}</code>
                  <span class="commit-subject">{commit.subject}</span>
                  <span class="commit-date">{commit.date}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .update-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-block: 1rem; }
  .update-log { max-height: 18rem; overflow: auto; white-space: pre-wrap; }
  .update-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .update-pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .update-pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .update-pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .update-metrics dd code { font-size: 0.9375rem; }
  .metric-note { margin: 0.375rem 0 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .commits-block { margin-top: 1rem; display: grid; gap: 0.5rem; }
  .commits-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.375rem; max-height: 14rem; overflow-y: auto; }
  .commit-row { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 0.375rem; font-size: 0.875rem; }
  .commit-row code { color: var(--accent); font-size: 0.8125rem; }
  .commit-subject { flex: 1 1 12rem; color: var(--text); overflow-wrap: anywhere; }
  .commit-date { font-size: 0.8125rem; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
