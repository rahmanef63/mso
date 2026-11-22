<script lang="ts">
  import {
    createSoftwareUpdateController,
    type SoftwareUpdateState,
    type SoftwareUpdateStatus,
  } from "./host-ops-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<SoftwareUpdateState>({ kind: "loading" });
  let controller: ReturnType<typeof createSoftwareUpdateController> | undefined;

  let isOwner = $derived(role === "owner");

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
    if (isOwner) void controller?.refresh();
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
      <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
        {view.kind === "loading" ? "Checking..." : "Refresh"}
      </button>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect software updates. Sign in from an Owner device to check version status.
    </p>
  {:else}
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
