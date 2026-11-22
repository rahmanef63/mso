<script lang="ts">
  import {
    createChannelsController,
    type ChannelItem,
    type ChannelsState,
  } from "./integrations-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<ChannelsState>({ kind: "loading" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createChannelsController> | undefined;

  let isOwner = $derived(role === "owner");

  let visibleChannels = $derived.by<ChannelItem[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.snapshot.channels;
    return view.snapshot.channels.filter((ch) =>
      `${ch.name} ${ch.provider} ${ch.id} ${ch.credentialUser} ${ch.credentialConnection} ${ch.enabled ? "enabled" : "disabled"}`
        .toLowerCase().includes(q));
  });

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.snapshot.channels.length === 0) return "empty";
    return visibleChannels.length === 0 ? "no-filter-matches" : "ready";
  });

  function connectionTone(ch: ChannelItem): "ok" | "warn" | "danger" | "neutral" {
    if (ch.connectionError || ch.connectionState === "missing" || ch.connectionState === "invalid") return "danger";
    if (ch.connectionState === "verified" || ch.lastCheck?.ok === true) return "ok";
    if (ch.lastCheck?.ok === false) return "danger";
    if (ch.connectionState === "configured") return "warn";
    return "neutral";
  }

  function formatTime(iso: string | null): string {
    if (!iso) return "";
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
  }

  export function refresh() {
    if (isOwner) void controller?.refresh();
  }

  function triggerTest(id: string) {
    if (isOwner) void controller?.runTest(id);
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      controller = undefined;
      return;
    }
    const next = createChannelsController((s) => { view = s; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });
</script>

<section aria-labelledby="channels-title" aria-busy={isOwner && view.kind === "loading"} data-channels-state={stateTag}>
  <header class="feature-header">
    <h2 id="channels-title">Channels</h2>
    {#if isOwner}
      <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to view and test configured messaging channels. Sign in from an Owner device to check channel connectivity.
    </p>
  {:else}
    <div class="ch-filter-wrap">
      <label for="channels-filter">Filter channels</label>
      <input id="channels-filter" type="search" bind:value={filterQuery} placeholder="Name, platform, credential, or status" />
    </div>

    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Loading configured channels...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else if view.snapshot.channels.length === 0}
        <p>No messaging channels configured yet.</p>
      {:else if visibleChannels.length === 0}
        <p>No channels match "{filterQuery.trim()}".</p>
      {:else}
        <ul class="ch-list" aria-label="Configured messaging channels">
          {#each visibleChannels as ch (ch.id)}
            {@const feedback = view.tests[ch.id]}
            <li class="ch-row">
              <div class="ch-info">
                <div class="ch-heading">
                  <strong>{ch.name}</strong>
                  <span class="pill">{ch.provider}</span>
                  <span class="pill" data-tone={ch.enabled ? "ok" : "neutral"}>
                    {ch.enabled ? "enabled" : "disabled"}
                  </span>
                  {#if ch.connectionState}
                    <span class="pill" data-tone={connectionTone(ch)}>{ch.connectionState}</span>
                  {/if}
                </div>
                <p class="ch-meta">
                  Credential: {ch.credentialUser}/{ch.credentialConnection}
                  {#if ch.lastCheck} | Last check: {ch.lastCheck.ok ? "ok" : "failed"} ({formatTime(ch.lastCheck.at)}){/if}
                </p>
                {#if ch.connectionError}
                  <p class="ch-err">Connection error: {ch.connectionError}</p>
                {/if}
                {#if feedback}
                  <p
                    class="feedback ch-feedback"
                    class:ok={feedback.status === "ok"}
                    class:error={feedback.status === "error"}
                    class:pending={feedback.status === "testing"}
                    role={feedback.status === "error" ? "alert" : "status"}
                  >
                    {feedback.message}
                  </p>
                {/if}
              </div>
              <div class="ch-actions">
                <button
                  type="button"
                  disabled={feedback?.status === "testing"}
                  onclick={() => triggerTest(ch.id)}
                >
                  {feedback?.status === "testing" ? "Testing..." : "Test"}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .ch-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .ch-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .ch-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .ch-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.625rem; max-height: 24rem; overflow-y: auto; }
  .ch-row {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .ch-info { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 14rem; }
  .ch-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .ch-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .ch-err { margin: 0; font-size: 0.8125rem; color: var(--danger); }
  .ch-feedback { margin-top: 0.375rem; padding: 0.5rem 0.75rem; font-size: 0.875rem; }
  .ch-actions { display: flex; align-items: center; gap: 0.5rem; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
